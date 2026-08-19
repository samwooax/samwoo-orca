import { randomUUID } from 'node:crypto'
import {
  cancelExcelArtifactWorker,
  runHermesOfficePreviewWorker
} from './hermes-excel-artifact-worker-client'

const MAX_PREVIEW_COUNT = 4
const MAX_ACTIVE_PREVIEWS = 2
const MAX_PREVIEW_IMAGE_BYTES = 700 * 1024
const MAX_PREVIEW_DIMENSION = 1600
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

export const HERMES_ACP_OFFICE_PREVIEW_PREFIX = '__SAMWOO_OFFICE_PREVIEW_V1__'

export type HermesAcpOfficePreviewResult = {
  kind: 'xlsx' | 'pptx'
  mediaType: 'image/png' | 'image/jpeg'
  imageBase64: string
  width: number
  height: number
  startIndex: number
  endIndex: number
  totalCount: number
  nextIndex: number | null
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`office preview returned an invalid ${name}`)
  }
  return Number(value)
}

function parseResult(
  value: Record<string, unknown>,
  requestedStartIndex: number,
  requestedCount: number
): HermesAcpOfficePreviewResult {
  const kind = value.kind
  const mediaType = value.mediaType
  const imageBase64 = value.imageBase64
  if (
    value.ok !== true ||
    (kind !== 'xlsx' && kind !== 'pptx') ||
    (mediaType !== 'image/png' && mediaType !== 'image/jpeg') ||
    typeof imageBase64 !== 'string' ||
    !BASE64_RE.test(imageBase64)
  ) {
    throw new Error('office preview worker returned an invalid result')
  }
  const bytes = Buffer.from(imageBase64, 'base64')
  const validSignature =
    (mediaType === 'image/png' &&
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
    (mediaType === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')))
  if (
    bytes.length < 1 ||
    bytes.length > MAX_PREVIEW_IMAGE_BYTES ||
    bytes.toString('base64') !== imageBase64 ||
    !validSignature
  ) {
    throw new Error('office preview worker returned an invalid image')
  }
  const result = {
    kind,
    mediaType,
    imageBase64,
    width: positiveInteger(value.width, 'width'),
    height: positiveInteger(value.height, 'height'),
    startIndex: positiveInteger(value.startIndex, 'startIndex'),
    endIndex: positiveInteger(value.endIndex, 'endIndex'),
    totalCount: positiveInteger(value.totalCount, 'totalCount'),
    nextIndex: value.nextIndex === null ? null : positiveInteger(value.nextIndex, 'nextIndex')
  } satisfies HermesAcpOfficePreviewResult
  if (
    result.width > MAX_PREVIEW_DIMENSION ||
    result.height > MAX_PREVIEW_DIMENSION ||
    result.startIndex !== requestedStartIndex ||
    result.endIndex < result.startIndex ||
    result.endIndex > result.totalCount ||
    result.endIndex !== Math.min(result.startIndex + requestedCount - 1, result.totalCount) ||
    (result.endIndex === result.totalCount
      ? result.nextIndex !== null
      : result.nextIndex !== result.endIndex + 1)
  ) {
    throw new Error('office preview worker returned invalid pagination')
  }
  return result
}

export class HermesAcpOfficePreview {
  private readonly active = new Map<string, AbortController | null>()

  async render(args: {
    sourcePath: string
    kind: 'xlsx' | 'pptx'
    startIndex?: number
    count?: number
    signal?: AbortSignal
  }): Promise<HermesAcpOfficePreviewResult> {
    if (this.active.size >= MAX_ACTIVE_PREVIEWS) {
      throw new Error('office preview capacity is reached')
    }
    const startIndex = args.startIndex ?? 1
    const count = Math.min(args.count ?? MAX_PREVIEW_COUNT, MAX_PREVIEW_COUNT)
    if (
      !Number.isSafeInteger(startIndex) ||
      startIndex < 1 ||
      !Number.isSafeInteger(count) ||
      count < 1
    ) {
      throw new Error('office preview request pagination is invalid')
    }
    const ownedAbort = new AbortController()
    const signal = args.signal ?? ownedAbort.signal
    if (signal.aborted) {
      throw new Error('office preview request was cancelled')
    }
    const requestId = `@acp-office-preview:${randomUUID()}`
    this.active.set(requestId, args.signal ? null : ownedAbort)
    try {
      const result = parseResult(
        await runHermesOfficePreviewWorker({
          requestId,
          sourcePath: args.sourcePath,
          kind: args.kind,
          startIndex,
          count,
          signal
        }),
        startIndex,
        count
      )
      if (result.kind !== args.kind) {
        throw new Error('office preview worker returned a mismatched result')
      }
      return result
    } finally {
      this.active.delete(requestId)
    }
  }

  cancelAll(): void {
    for (const [requestId, abort] of this.active) {
      abort?.abort()
      cancelExcelArtifactWorker(requestId)
    }
  }
}
