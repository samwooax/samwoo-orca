import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HermesAcpOfficePreview } from './hermes-team-chat-acp-office-preview'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  run: vi.fn()
}))

vi.mock('./hermes-excel-artifact-worker-client', () => ({
  cancelExcelArtifactWorker: mocks.cancel,
  runHermesOfficePreviewWorker: mocks.run
}))

function result(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    kind: 'xlsx',
    mediaType: 'image/png',
    imageBase64: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'),
    width: 800,
    height: 600,
    startIndex: 1,
    endIndex: 4,
    totalCount: 8,
    nextIndex: 5,
    ...overrides
  }
}

beforeEach(() => {
  mocks.cancel.mockReset()
  mocks.run.mockReset().mockResolvedValue(result())
})

describe('HermesAcpOfficePreview', () => {
  it('runs a bounded worker request and validates its image result', async () => {
    const preview = new HermesAcpOfficePreview()
    const abort = new AbortController()

    await expect(
      preview.render({
        sourcePath: 'C:\\project\\report.xlsx',
        kind: 'xlsx',
        startIndex: 1,
        count: 99,
        signal: abort.signal
      })
    ).resolves.toEqual({
      kind: 'xlsx',
      mediaType: 'image/png',
      imageBase64: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'),
      width: 800,
      height: 600,
      startIndex: 1,
      endIndex: 4,
      totalCount: 8,
      nextIndex: 5
    })
    expect(mocks.run).toHaveBeenCalledWith({
      sourcePath: 'C:\\project\\report.xlsx',
      kind: 'xlsx',
      startIndex: 1,
      count: 4,
      requestId: expect.stringMatching(/^@acp-office-preview:/),
      signal: abort.signal
    })
  })

  it('rejects malformed pagination and cancels active worker requests', async () => {
    mocks.run.mockResolvedValueOnce(result({ endIndex: 6 }))
    const preview = new HermesAcpOfficePreview()

    await expect(
      preview.render({ sourcePath: 'C:\\project\\report.xlsx', kind: 'xlsx' })
    ).rejects.toThrow('invalid pagination')

    mocks.run.mockResolvedValueOnce(result({ nextIndex: null }))
    await expect(
      preview.render({ sourcePath: 'C:\\project\\report.xlsx', kind: 'xlsx' })
    ).rejects.toThrow('invalid pagination')

    mocks.run.mockResolvedValueOnce(result({ endIndex: 3, nextIndex: 4 }))
    await expect(
      preview.render({ sourcePath: 'C:\\project\\report.xlsx', kind: 'xlsx' })
    ).rejects.toThrow('invalid pagination')

    mocks.run.mockReturnValueOnce(new Promise(() => {}))
    void preview.render({ sourcePath: 'C:\\project\\slides.pptx', kind: 'pptx' })
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(4))
    const requestId = mocks.run.mock.calls[3]?.[0].requestId
    const signal = mocks.run.mock.calls[3]?.[0].signal as AbortSignal
    preview.cancelAll()

    expect(mocks.cancel).toHaveBeenCalledWith(requestId)
    expect(signal.aborted).toBe(true)
  })

  it('rejects images that would exhaust the four-read turn budget', async () => {
    const image = Buffer.alloc(700 * 1024 + 1)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(image)
    mocks.run.mockResolvedValueOnce(result({ imageBase64: image.toString('base64') }))

    await expect(
      new HermesAcpOfficePreview().render({
        sourcePath: 'C:\\project\\report.xlsx',
        kind: 'xlsx'
      })
    ).rejects.toThrow('invalid image')
  })
})
