import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { Store } from '../persistence'
import { isCommandOnLocalPath } from './command-path-resolver'
import { resolveAuthorizedPath } from './filesystem-auth'
import type {
  LocalCommandOperation,
  LocalCommandRequest,
  LocalCommandResult
} from './hermes-local-command-protocol'

const MAX_OUTPUT_BYTES = 64 * 1024
const BACKGROUND_STARTUP_MS = 5_000
const DEFAULT_FOREGROUND_TIMEOUT_SECONDS = 120

type ManagedProcess = {
  process: ChildProcessWithoutNullStreams
  root: string
}

const managedProcesses = new Map<string, ManagedProcess>()

function appendOutput(current: string, chunk: Buffer): string {
  const combined = current + chunk.toString('utf8')
  return Buffer.byteLength(combined) <= MAX_OUTPUT_BYTES
    ? combined
    : Buffer.from(combined).subarray(-MAX_OUTPUT_BYTES).toString('utf8')
}

function findLocalUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/[^\s]*)?/i)
  return match?.[0]
}

async function resolveProjectRoot(cwd: string, store: Store): Promise<string> {
  if (!cwd.trim()) {
    throw new Error('no local project is selected')
  }
  const root = await resolveAuthorizedPath(cwd, store)
  if (!(await stat(root)).isDirectory()) {
    throw new Error('selected project root is not a directory')
  }
  return root
}

function stopManagedProcess(
  root: string,
  operation: Extract<LocalCommandOperation, { kind: 'stop' }>
): LocalCommandResult {
  const managed = managedProcesses.get(operation.processId)
  if (!managed || managed.root !== root) {
    return {
      id: operation.id,
      ok: false,
      error: 'process is not running in this project'
    }
  }
  managed.process.kill()
  managedProcesses.delete(operation.processId)
  return {
    id: operation.id,
    ok: true,
    status: 'stopped',
    processId: operation.processId
  }
}

async function runForeground(
  root: string,
  operation: Extract<LocalCommandOperation, { kind: 'run' }>
): Promise<LocalCommandResult> {
  return new Promise((resolveResult) => {
    let output = ''
    let settled = false
    const process = spawn(operation.command, operation.args, {
      cwd: root,
      env: { ...globalThis.process.env, PYTHONUNBUFFERED: '1' },
      shell: false,
      windowsHide: true
    })
    const finish = (result: LocalCommandResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolveResult(result)
    }
    process.stdout.on('data', (chunk: Buffer) => {
      output = appendOutput(output, chunk)
    })
    process.stderr.on('data', (chunk: Buffer) => {
      output = appendOutput(output, chunk)
    })
    process.on('error', (error) =>
      finish({ id: operation.id, ok: false, output, error: error.message })
    )
    process.on('close', (exitCode) =>
      finish({
        id: operation.id,
        ok: exitCode === 0,
        status: 'completed',
        exitCode,
        output,
        ...(exitCode === 0 ? {} : { error: `command exited with code ${exitCode ?? 'unknown'}` })
      })
    )
    const timeoutSeconds = operation.timeoutSeconds ?? DEFAULT_FOREGROUND_TIMEOUT_SECONDS
    const timer = setTimeout(() => {
      process.kill()
      finish({
        id: operation.id,
        ok: false,
        output,
        error: `command timed out after ${timeoutSeconds} seconds`
      })
    }, timeoutSeconds * 1_000)
  })
}

async function runBackground(
  root: string,
  operation: Extract<LocalCommandOperation, { kind: 'run' }>
): Promise<LocalCommandResult> {
  return new Promise((resolveResult) => {
    const processId = randomUUID()
    let output = ''
    let settled = false
    const process = spawn(operation.command, operation.args, {
      cwd: root,
      env: { ...globalThis.process.env, PYTHONUNBUFFERED: '1' },
      shell: false,
      windowsHide: true
    })
    managedProcesses.set(processId, { process, root })
    const finishStartup = (result: LocalCommandResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolveResult(result)
    }
    const record = (chunk: Buffer): void => {
      output = appendOutput(output, chunk)
      const url = findLocalUrl(output)
      if (url) {
        finishStartup({
          id: operation.id,
          ok: true,
          status: 'running',
          processId,
          url,
          output
        })
      }
    }
    process.stdout.on('data', record)
    process.stderr.on('data', record)
    process.on('error', (error) => {
      managedProcesses.delete(processId)
      finishStartup({
        id: operation.id,
        ok: false,
        output,
        error: error.message
      })
    })
    process.on('close', (exitCode) => {
      managedProcesses.delete(processId)
      if (!settled) {
        finishStartup({
          id: operation.id,
          ok: false,
          status: 'completed',
          exitCode,
          output,
          error: `background command exited with code ${exitCode ?? 'unknown'}`
        })
      }
    })
    const timer = setTimeout(
      () =>
        finishStartup({
          id: operation.id,
          ok: true,
          status: 'running',
          processId,
          output
        }),
      BACKGROUND_STARTUP_MS
    )
  })
}

async function executeOperation(
  root: string,
  operation: LocalCommandOperation
): Promise<LocalCommandResult> {
  if (operation.kind === 'stop') {
    return stopManagedProcess(root, operation)
  }
  if (operation.args.some((arg) => arg.includes('\0'))) {
    return {
      id: operation.id,
      ok: false,
      error: 'command arguments contain invalid characters'
    }
  }
  if (!(await isCommandOnLocalPath(operation.command, { cwd: root }))) {
    return {
      id: operation.id,
      ok: false,
      error: `command is not installed: ${operation.command}`
    }
  }
  return operation.mode === 'background'
    ? runBackground(root, operation)
    : runForeground(root, operation)
}

export async function executeLocalCommandRequest(args: {
  cwd: string
  request: LocalCommandRequest
  store: Store
  onOperationStart?: (operation: LocalCommandOperation) => void
  onOperationComplete?: (operation: LocalCommandOperation, result: LocalCommandResult) => void
}): Promise<LocalCommandResult[]> {
  const root = await resolveProjectRoot(args.cwd, args.store)
  const results: LocalCommandResult[] = []
  for (const operation of args.request.operations) {
    args.onOperationStart?.(operation)
    let result: LocalCommandResult
    try {
      result = await executeOperation(root, operation)
    } catch (error) {
      result = {
        id: operation.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    args.onOperationComplete?.(operation, result)
    results.push(result)
    if (!result.ok) {
      break
    }
  }
  return results
}
