import { parentPort, workerData } from 'node:worker_threads'
import { executeLocalDocumentWorkerOperation } from './hermes-local-document-worker-operations'
import type {
  LocalDocumentWorkerRequest,
  LocalDocumentWorkerResponse
} from './hermes-local-document-worker-protocol'

if (!parentPort) {
  throw new Error('Hermes local document worker must run with a parent port.')
}
const port = parentPort

void executeLocalDocumentWorkerOperation(workerData as LocalDocumentWorkerRequest)
  .then((value) => {
    const response: LocalDocumentWorkerResponse = { ok: true, value }
    const transferList = value.output ? [value.output.buffer as ArrayBuffer] : []
    port.postMessage(response, transferList)
  })
  .catch((error: unknown) => {
    const response: LocalDocumentWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
    port.postMessage(response)
  })
