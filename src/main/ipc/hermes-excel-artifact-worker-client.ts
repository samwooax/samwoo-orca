import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type {
  ExcelArtifactCapability,
  ExcelArtifactRequest,
  ExcelArtifactResult
} from '../../shared/hermes-excel-artifact'

const MAX_WORKER_RESULT_BYTES = 2 * 1024 * 1024
const activeWorkers = new Map<string, ChildProcessWithoutNullStreams>()
const cancelledWorkers = new WeakSet<ChildProcessWithoutNullStreams>()
let capabilityProbe: Promise<ExcelArtifactCapability | null> | null = null

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

async function verifyWorkerBundle(root: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Record<
    string,
    string
  >
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name !== 'manifest.json')
    .map((entry) => join(entry.parentPath, entry.name))
  if (files.length !== Object.keys(manifest).length) {
    throw new Error('Excel Artifact worker manifest does not match the bundle')
  }
  await Promise.all(
    files.map(async (file) => {
      const key = relative(root, file).replaceAll('\\', '/')
      const expected = manifest[key]
      const actual = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
      if (!expected || actual !== expected) {
        throw new Error('Excel Artifact worker integrity check failed')
      }
    })
  )
}

function runWorkerLine(
  payload: Record<string, unknown>,
  requestId: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
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
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('Excel Artifact worker timed out'))
    }, timeoutMs)
    timer.unref?.()
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk])
      if (stdout.length > MAX_WORKER_RESULT_BYTES) {
        proc.kill()
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > 64 * 1024) {
        proc.kill()
      }
    })
    proc.once('error', reject)
    proc.once('close', (code) => {
      clearTimeout(timer)
      if (activeWorkers.get(requestId) === proc) {
        activeWorkers.delete(requestId)
      }
      if (code !== 0 || stdout.length === 0 || stdout.length > MAX_WORKER_RESULT_BYTES) {
        reject(
          new Error(
            cancelledWorkers.has(proc)
              ? 'Excel Artifact worker was cancelled'
              : 'Excel Artifact worker failed'
          )
        )
        return
      }
      try {
        resolveResult(JSON.parse(stdout.toString('utf8').trim()) as Record<string, unknown>)
      } catch {
        reject(new Error('Excel Artifact worker returned an invalid result'))
      }
    })
    proc.stdin.end(`${JSON.stringify(payload)}\n`)
  })
}

export async function getExcelArtifactCapability(): Promise<ExcelArtifactCapability | null> {
  capabilityProbe ??= (async () => {
    try {
      const root = workerRoot()
      await verifyWorkerBundle(root)
      const result = await runWorkerLine({ hostAction: 'capability' }, '@capability', 15_000)
      const capability = result.capability as ExcelArtifactCapability | undefined
      return result.ok === true && capability?.name === 'excelArtifact' ? capability : null
    } catch {
      return null
    }
  })()
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

export function cancelExcelArtifactWorker(requestId: string): boolean {
  const worker = activeWorkers.get(requestId)
  if (!worker) {
    return false
  }
  cancelledWorkers.add(worker)
  worker.kill()
  activeWorkers.delete(requestId)
  return true
}
