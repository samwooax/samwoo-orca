import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type {
  ExcelArtifactCapability,
  ExcelArtifactRequest,
  ExcelArtifactResult
} from '../../shared/hermes-excel-artifact'
import { killWithDescendantSweep } from '../pty-descendant-termination'

const MAX_WORKER_RESULT_BYTES = 2 * 1024 * 1024
const activeWorkers = new Map<string, ChildProcessWithoutNullStreams>()
const cancelledWorkers = new WeakSet<ChildProcessWithoutNullStreams>()
const terminatingWorkers = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>()
let capabilityProbe: Promise<ExcelArtifactCapability | null> | null = null
let cachedCapability: ExcelArtifactCapability | null | undefined

export const HERMES_OFFICE_PREVIEW_WORKER_TIMEOUT_MS = 160_000

function workerRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'hermes-excel-artifact-worker')
    : resolve(
        process.cwd(),
        'resources',
        'hermes-excel-artifact-worker',
        `${process.platform}-${process.arch}`,
        'orca-excel-artifact-worker'
      )
}

function workerExecutable(root: string): string {
  return join(
    root,
    process.platform === 'win32' ? 'orca-excel-artifact-worker.exe' : 'orca-excel-artifact-worker'
  )
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const digest = createHash('sha256')
    const input = createReadStream(path)
    input.on('data', (chunk) => digest.update(chunk))
    input.once('error', reject)
    input.once('end', () => resolveHash(digest.digest('hex')))
  })
}

export async function verifyExcelArtifactWorkerBundle(
  root: string,
  signal?: AbortSignal
): Promise<void> {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Record<
    string,
    string
  >
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => relative(root, file).replaceAll('\\', '/') !== 'manifest.json')
  if (files.length !== Object.keys(manifest).length) {
    throw new Error('Excel Artifact worker manifest does not match the bundle')
  }
  let nextFile = 0
  const verifyNext = async (): Promise<void> => {
    while (nextFile < files.length) {
      signal?.throwIfAborted()
      const file = files[nextFile]
      nextFile += 1
      const key = relative(root, file).replaceAll('\\', '/')
      const expected = manifest[key]
      if (!expected || (await sha256File(file)) !== expected) {
        throw new Error('Excel Artifact worker integrity check failed')
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(files.length, 4) }, verifyNext))
}

function terminateWorker(requestId: string, worker: ChildProcessWithoutNullStreams): Promise<void> {
  const existing = terminatingWorkers.get(worker)
  if (existing) {
    return existing
  }
  const ownsRoot = (): boolean =>
    activeWorkers.get(requestId) === worker &&
    worker.exitCode === null &&
    worker.signalCode === null
  let rootSignalled = false
  const killRoot = (): void => {
    if (rootSignalled) {
      return
    }
    rootSignalled = true
    try {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill('SIGKILL')
      }
    } catch {}
  }
  const termination = worker.pid
    ? killWithDescendantSweep(worker.pid, killRoot, { ownsRoot }).catch(killRoot)
    : Promise.resolve(killRoot())
  terminatingWorkers.set(worker, termination)
  return termination
}

function runWorkerLine(
  payload: Record<string, unknown>,
  requestId: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  if (signal?.aborted) {
    return Promise.reject(new Error('Excel Artifact worker was cancelled'))
  }
  return new Promise((resolveResult, reject) => {
    const root = workerRoot()
    const proc = spawn(workerExecutable(root), [], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })
    activeWorkers.set(requestId, proc)
    let stdout = Buffer.alloc(0)
    let stderrBytes = 0
    let failure: Error | null = null
    const terminate = (error: Error, cancelled = false): void => {
      failure ??= error
      if (cancelled) {
        cancelledWorkers.add(proc)
      }
      void terminateWorker(requestId, proc)
    }
    const timer = setTimeout(() => {
      terminate(new Error('Excel Artifact worker timed out'))
    }, timeoutMs)
    timer.unref?.()
    const abort = (): void => {
      terminate(new Error('Excel Artifact worker was cancelled'), true)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
    }
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk])
      if (stdout.length > MAX_WORKER_RESULT_BYTES) {
        terminate(new Error('Excel Artifact worker failed'))
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > 64 * 1024) {
        terminate(new Error('Excel Artifact worker failed'))
      }
    })
    proc.once('error', (error) => (failure ??= error))
    proc.once('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (activeWorkers.get(requestId) === proc) {
        activeWorkers.delete(requestId)
      }
      void (async () => {
        await terminatingWorkers.get(proc)
        if (cancelledWorkers.has(proc)) {
          reject(new Error('Excel Artifact worker was cancelled'))
          return
        }
        if (failure) {
          reject(failure)
          return
        }
        if (code !== 0 || stdout.length === 0 || stdout.length > MAX_WORKER_RESULT_BYTES) {
          reject(new Error('Excel Artifact worker failed'))
          return
        }
        try {
          resolveResult(JSON.parse(stdout.toString('utf8').trim()) as Record<string, unknown>)
        } catch {
          reject(new Error('Excel Artifact worker returned an invalid result'))
        }
      })()
    })
    proc.stdin.end(`${JSON.stringify(payload)}\n`)
  })
}

async function probeExcelArtifactCapability(
  requestId: string,
  signal?: AbortSignal
): Promise<ExcelArtifactCapability | null> {
  try {
    if (signal?.aborted) {
      throw new Error('Excel Artifact worker was cancelled')
    }
    const root = workerRoot()
    await verifyExcelArtifactWorkerBundle(root, signal)
    if (signal?.aborted) {
      throw new Error('Excel Artifact worker was cancelled')
    }
    const result = await runWorkerLine({ hostAction: 'capability' }, requestId, 15_000, signal)
    if (signal?.aborted) {
      throw new Error('Excel Artifact worker was cancelled')
    }
    const capability = result.capability as ExcelArtifactCapability | undefined
    return result.ok === true && capability?.name === 'excelArtifact' ? capability : null
  } catch {
    if (signal?.aborted) {
      throw new Error('Excel Artifact worker was cancelled')
    }
    return null
  }
}

export async function getExcelArtifactCapability(
  options: {
    requestId?: string
    signal?: AbortSignal
  } = {}
): Promise<ExcelArtifactCapability | null> {
  if (options.signal?.aborted) {
    throw new Error('Excel Artifact worker was cancelled')
  }
  if (cachedCapability !== undefined) {
    return cachedCapability
  }
  if (options.signal) {
    const capability = await probeExcelArtifactCapability(
      options.requestId ?? '@capability',
      options.signal
    )
    cachedCapability = capability
    return capability
  }
  capabilityProbe ??= probeExcelArtifactCapability('@capability').then((capability) => {
    cachedCapability = capability
    return capability
  })
  return capabilityProbe
}

export async function runExcelArtifactWorker(args: {
  requestId: string
  jobId: string
  workspace: string
  request: ExcelArtifactRequest
  artifacts: { artifactId: string; path: string; sha256: string; sizeBytes: number }[]
}): Promise<ExcelArtifactResult> {
  const result = await runWorkerLine(
    { hostAction: 'run', ...args },
    args.requestId,
    Math.min((args.request.timeoutSeconds ?? 300) * 1_000 + 5_000, 605_000)
  )
  return result as ExcelArtifactResult
}

export async function runOfficeDocumentWorker(
  requestId: string,
  documentRequest: Record<string, unknown>,
  timeoutMs = 120_000
): Promise<Record<string, unknown>> {
  return runWorkerLine({ hostAction: 'document', documentRequest }, requestId, timeoutMs)
}

export async function runHermesOfficePreviewWorker(args: {
  requestId: string
  sourcePath: string
  kind: 'xlsx' | 'pptx'
  startIndex: number
  count: number
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  if (!(await getExcelArtifactCapability({ requestId: args.requestId, signal: args.signal }))) {
    throw new Error('Hermes office preview worker is unavailable')
  }
  if (args.signal?.aborted) {
    throw new Error('Excel Artifact worker was cancelled')
  }
  const root = workerRoot()
  return runWorkerLine(
    {
      hostAction: 'officePreview',
      previewRequest: {
        sourcePath: args.sourcePath,
        libreOfficePath: join(root, 'libreoffice', 'program', 'soffice.exe'),
        kind: args.kind,
        startIndex: args.startIndex,
        count: args.count
      }
    },
    args.requestId,
    HERMES_OFFICE_PREVIEW_WORKER_TIMEOUT_MS,
    args.signal
  )
}

export function cancelExcelArtifactWorker(requestId: string): boolean {
  const worker = activeWorkers.get(requestId)
  if (!worker) {
    return false
  }
  cancelledWorkers.add(worker)
  terminateWorker(requestId, worker)
  return true
}
