import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Store } from '../persistence'
import { resolveAuthorizedPath } from './filesystem-auth'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import { executeDocumentTranslationOperation } from './hermes-local-document-translation'
import type {
  LocalDocumentAttachment,
  LocalDocumentOperation,
  LocalDocumentRequest,
  LocalDocumentResult
} from './hermes-local-document-protocol'
import {
  executeOfficeDocumentOperation,
  isOfficeDocumentOperation
} from './hermes-local-office-documents'

const MAX_RESULT_BYTES = 768 * 1024
const projectQueues = new Map<string, Promise<void>>()

function validateRelativePath(value: string): string {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    throw new Error('invalid relative path')
  }
  const normalized = value.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (
    segments.some(
      (segment) => segment === '..' || segment === '' || segment.toLowerCase() === '.git'
    )
  ) {
    throw new Error('path traversal and Git metadata access are not allowed')
  }
  return normalized
}

function isInsideRoot(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

async function projectRoot(cwd: string, store: Store): Promise<string> {
  if (!cwd.trim()) {
    throw new Error('no local project is selected')
  }
  const root = await resolveAuthorizedPath(cwd, store)
  if (!(await stat(root)).isDirectory()) {
    throw new Error('selected project root is not a directory')
  }
  return root
}

async function projectPath(root: string, value: string, store: Store): Promise<string> {
  const target = await resolveAuthorizedPath(resolve(root, validateRelativePath(value)), store)
  if (!isInsideRoot(root, target)) {
    throw new Error('path resolves outside the selected project')
  }
  return target
}

async function executeOperation(args: {
  resolveRoot: () => Promise<string>
  operation: LocalDocumentOperation
  store: Store
  attachments?: LocalDocumentAttachment[]
  artifactStore?: HermesBinaryArtifactStore
  conversationId: string
  requestId: string
  allowNativeSave: boolean
}): Promise<LocalDocumentResult> {
  const resolveProjectPath = async (path: string): Promise<string> =>
    projectPath(await args.resolveRoot(), path, args.store)
  try {
    if (isOfficeDocumentOperation(args.operation)) {
      return await executeOfficeDocumentOperation({
        cwd: args.allowNativeSave ? '' : await args.resolveRoot(),
        operation: args.operation,
        store: args.store,
        attachments: args.attachments,
        artifactStore: args.artifactStore,
        conversationId: args.conversationId,
        requestId: args.requestId,
        allowNativeSave: args.allowNativeSave
      })
    }
    return await executeDocumentTranslationOperation({
      operation: args.operation,
      store: args.store,
      attachments: args.attachments,
      artifactStore: args.artifactStore,
      conversationId: args.conversationId,
      requestId: args.requestId,
      allowNativeSave: args.allowNativeSave,
      resolveProjectPath
    })
  } catch (error) {
    return {
      id: args.operation.id,
      ok: false,
      ...('path' in args.operation ? { path: args.operation.path } : {}),
      ...('outputPath' in args.operation ? { outputPath: args.operation.outputPath } : {}),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function runQueued<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent
  })
  const queued = previous.then(() => current)
  projectQueues.set(key, queued)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (projectQueues.get(key) === queued) {
      projectQueues.delete(key)
    }
  }
}

export async function executeLocalDocumentRequest(args: {
  cwd: string
  request: LocalDocumentRequest
  store: Store
  artifactStore?: HermesBinaryArtifactStore
  conversationId?: string
  requestId?: string
  attachments?: LocalDocumentAttachment[]
  onOperationStart?: (operation: LocalDocumentOperation) => void
  onOperationComplete?: (operation: LocalDocumentOperation, result: LocalDocumentResult) => void
}): Promise<LocalDocumentResult[]> {
  let rootPromise: Promise<string> | null = null
  const resolveRoot = (): Promise<string> => {
    rootPromise ??= projectRoot(args.cwd, args.store)
    return rootPromise
  }
  const queueKey = args.cwd.trim() ? resolve(args.cwd) : '@attachments'
  return runQueued(queueKey, async () => {
    const results: LocalDocumentResult[] = []
    let resultBytes = 0
    for (const operation of args.request.operations) {
      args.onOperationStart?.(operation)
      const result = await executeOperation({
        resolveRoot,
        operation,
        store: args.store,
        attachments: args.attachments,
        artifactStore: args.artifactStore,
        conversationId: args.conversationId ?? '',
        requestId: args.requestId ?? '',
        allowNativeSave: !args.cwd.trim()
      })
      const size = Buffer.byteLength(JSON.stringify(result))
      if (resultBytes + size > MAX_RESULT_BYTES) {
        const overflow: LocalDocumentResult = {
          id: operation.id,
          ok: false,
          ...('path' in operation ? { path: operation.path } : {}),
          ...('outputPath' in operation ? { outputPath: operation.outputPath } : {}),
          error: 'local document results are too large; retry extraction with a smaller limit'
        }
        args.onOperationComplete?.(operation, overflow)
        results.push(overflow)
        break
      }
      resultBytes += size
      args.onOperationComplete?.(operation, result)
      results.push(result)
    }
    return results
  })
}
