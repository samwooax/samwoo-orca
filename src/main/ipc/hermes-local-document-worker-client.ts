import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type {
  LocalDocumentWorkerRequest,
  LocalDocumentWorkerResponse,
  LocalDocumentWorkerValue
} from './hermes-local-document-worker-protocol'

const DOCUMENT_WORKER_TIMEOUT_MS = 30_000
const activeWorkers = new Map<string, Set<Worker>>()

function trackWorker(requestId: string, worker: Worker): void {
  if (!requestId) {
    return
  }
  const workers = activeWorkers.get(requestId) ?? new Set<Worker>()
  workers.add(worker)
  activeWorkers.set(requestId, workers)
}

function untrackWorker(requestId: string, worker: Worker): void {
  const workers = activeWorkers.get(requestId)
  workers?.delete(worker)
  if (workers?.size === 0) {
    activeWorkers.delete(requestId)
  }
}

function workerEntryPath(): string {
  let packaged = false
  try {
    packaged = require('electron').app?.isPackaged === true
  } catch {
    packaged = false
  }
  return packaged
    ? join(
        process.resourcesPath,
        'app.asar.unpacked',
        'out',
        'main',
        'hermes-local-document-worker-entry.js'
      )
    : join(__dirname, 'hermes-local-document-worker-entry.js')
}

function validResponse(value: unknown): value is LocalDocumentWorkerResponse {
  if (!value || typeof value !== 'object') {
    return false
  }
  const response = value as Partial<LocalDocumentWorkerResponse>
  return response.ok === true
    ? Boolean(response.value)
    : response.ok === false && typeof response.error === 'string'
}

export function runLocalDocumentWorker(
  request: LocalDocumentWorkerRequest,
  requestId = ''
): Promise<LocalDocumentWorkerValue> {
  return new Promise((resolve, reject) => {
    const path = workerEntryPath()
    if (!existsSync(path)) {
      reject(new Error(`Hermes local document worker entry not found: ${path}`))
      return
    }
    const data = Uint8Array.from(request.data)
    const worker = new Worker(path, {
      workerData: { ...request, data },
      transferList: [data.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 8
      }
    })
    trackWorker(requestId, worker)
    let settled = false
    const finish = (error?: Error, value?: LocalDocumentWorkerValue): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      untrackWorker(requestId, worker)
      worker.removeAllListeners()
      if (error) {
        reject(error)
      } else {
        resolve(value!)
      }
    }
    const timeout = setTimeout(() => {
      finish(new Error('local document processing timed out'))
      void worker.terminate()
    }, DOCUMENT_WORKER_TIMEOUT_MS)
    timeout.unref?.()
    worker.once('message', (response: unknown) => {
      if (!validResponse(response)) {
        finish(new Error('local document worker returned an invalid response'))
        void worker.terminate()
        return
      }
      finish(
        response.ok ? undefined : new Error(response.error),
        response.ok ? response.value : undefined
      )
      void worker.terminate()
    })
    worker.once('error', (error: unknown) =>
      finish(error instanceof Error ? error : new Error(String(error)))
    )
    worker.once('exit', () =>
      finish(new Error('local document worker exited before returning a result'))
    )
  })
}

export function cancelLocalDocumentWorkers(requestId: string): boolean {
  const workers = activeWorkers.get(requestId)
  if (!workers?.size) {
    return false
  }
  activeWorkers.delete(requestId)
  for (const worker of workers) {
    void worker.terminate()
  }
  return true
}
