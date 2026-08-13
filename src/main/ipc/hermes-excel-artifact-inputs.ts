import type { ExcelArtifactInput, ExcelArtifactRequest } from '../../shared/hermes-excel-artifact'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import type { LocalDocumentAttachment } from './hermes-local-document-protocol'

function replaceWorkbookArtifactPaths(value: unknown, paths: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceWorkbookArtifactPaths(item, paths))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'artifactPath' && typeof item === 'string') {
      const artifactId = paths.get(item)
      if (!artifactId) {
        throw new Error(`Excel image artifact is unavailable: ${item}`)
      }
      result.artifactId = artifactId
    } else {
      result[key] = replaceWorkbookArtifactPaths(item, paths)
    }
  }
  return result
}

export async function prepareExcelArtifactInputs(args: {
  request: ExcelArtifactRequest
  attachments?: LocalDocumentAttachment[]
  artifactStore: HermesBinaryArtifactStore
  conversationId: string
  requestId: string
}): Promise<{
  request: ExcelArtifactRequest
  artifacts: { artifactId: string; path: string; sha256: string; sizeBytes: number }[]
}> {
  const paths = new Map(args.attachments?.map((item) => [item.path, item.artifactId]))
  const allowedIds = new Set(args.attachments?.map((item) => item.artifactId))
  const artifacts = new Map<
    string,
    Awaited<ReturnType<HermesBinaryArtifactStore['resolveForWorker']>>
  >()
  for (const attachment of args.attachments ?? []) {
    artifacts.set(
      attachment.artifactId,
      await args.artifactStore.resolveForWorker(
        attachment.artifactId,
        args.conversationId,
        args.requestId
      )
    )
  }
  const inputs: ExcelArtifactInput[] = []
  for (const input of args.request.inputs ?? []) {
    const artifactId = (input.path ? paths.get(input.path) : undefined) ?? input.artifactId
    if (!artifactId) {
      inputs.push(input)
      continue
    }
    if (!allowedIds.has(artifactId)) {
      throw new Error('artifact is not attached to this request')
    }
    const artifact = await args.artifactStore.resolveForWorker(
      artifactId,
      args.conversationId,
      args.requestId
    )
    artifacts.set(artifactId, artifact)
    const { path: _path, ...safeInput } = input
    inputs.push({ ...safeInput, artifactId })
  }
  return {
    request: {
      ...args.request,
      ...(args.request.inputs ? { inputs } : {}),
      ...(args.request.workbookSpec
        ? {
            workbookSpec: replaceWorkbookArtifactPaths(args.request.workbookSpec, paths) as Record<
              string,
              unknown
            >
          }
        : {})
    },
    artifacts: [...artifacts.values()]
  }
}
