import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeLocalProjectToolReply } from './hermes-local-project-tool-loop'

const {
  approveLocalCommandRequestMock,
  executeLocalCommandRequestMock,
  executeLocalDocumentRequestMock,
  executeLocalFileRequestMock
} = vi.hoisted(() => ({
  approveLocalCommandRequestMock: vi.fn().mockResolvedValue(true),
  executeLocalCommandRequestMock: vi.fn(),
  executeLocalDocumentRequestMock: vi.fn(),
  executeLocalFileRequestMock: vi.fn()
}))

vi.mock('./hermes-local-command-approval', () => ({
  approveLocalCommandRequest: approveLocalCommandRequestMock
}))
vi.mock('./hermes-local-project-commands', () => ({
  executeLocalCommandRequest: executeLocalCommandRequestMock
}))
vi.mock('./hermes-local-project-files', () => ({
  executeLocalFileRequest: executeLocalFileRequestMock
}))
vi.mock('./hermes-local-project-documents', () => ({
  executeLocalDocumentRequest: executeLocalDocumentRequestMock
}))

const COMMAND_REPLY = `<orca_local_commands>
{"version":1,"operations":[{"id":"a","kind":"run","command":"node","args":["-v"],"mode":"foreground"}]}
</orca_local_commands>`

const FILE_REPLY = `<orca_local_files>
{"version":1,"operations":[{"id":"a","kind":"list","path":"."}]}
</orca_local_files>`

const DOCUMENT_REPLY = `<orca_local_documents>
{"version":1,"operations":[{"id":"pdf","kind":"extract","path":"report.pdf","cursor":0,"limit":10}]}
</orca_local_documents>`

const ATTACHMENT_DOCUMENT_REPLY = `<orca_local_documents>
{"version":1,"operations":[{"id":"pdf","kind":"extract","path":"@attachments/1-report.pdf","cursor":0,"limit":10}]}
</orca_local_documents>`

beforeEach(() => {
  approveLocalCommandRequestMock.mockReset().mockResolvedValue(true)
  executeLocalCommandRequestMock.mockReset()
  executeLocalDocumentRequestMock.mockReset()
  executeLocalFileRequestMock.mockReset()
})

describe('executeLocalProjectToolReply protocol admission', () => {
  it('identifies legacy command fields instead of returning them as ordinary text', async () => {
    const reply =
      '<orca_local_commands>{"version":1,"operations":[{"id":"run","kind":"run","command":"uv","args":["run","app.py"],"foreground":true,"timeoutMs":120000}]}</orca_local_commands>'

    const result = await executeLocalProjectToolReply({
      reply,
      cwd: 'C:\\selected',
      store: {} as never,
      requestId: 'request-invalid'
    })

    expect(result).toEqual({
      kind: 'invalid',
      error: 'invalid local command envelope; use mode and timeoutSeconds fields'
    })
    expect(executeLocalCommandRequestMock).not.toHaveBeenCalled()
  })

  it('fails closed when an unavailable Excel Artifact envelope appears', async () => {
    const result = await executeLocalProjectToolReply({
      reply:
        '<orca_excel_artifact>{"version":1,"operationId":"operation-1","idempotencyKey":"idempotency-key-1","action":"create"}</orca_excel_artifact>',
      cwd: 'C:\\selected',
      store: {} as never,
      requestId: 'request-excel-artifact'
    })

    expect(result).toEqual({ kind: 'invalid', error: 'Excel Artifact capability is unavailable' })
  })

  it('rejects replies containing both local tool envelopes', async () => {
    const result = await executeLocalProjectToolReply({
      reply: FILE_REPLY + COMMAND_REPLY,
      cwd: 'C:\\selected',
      store: {} as never,
      requestId: 'request-multiple'
    })

    expect(result).toEqual({
      kind: 'invalid',
      error: 'local tool reply must contain exactly one file, document, command, or Excel envelope'
    })
    expect(executeLocalCommandRequestMock).not.toHaveBeenCalled()
    expect(executeLocalFileRequestMock).not.toHaveBeenCalled()
  })

  it('executes a document request and records progress and operation metadata', async () => {
    const onProgress = vi.fn()
    executeLocalDocumentRequestMock.mockImplementation(async (args) => {
      args.onOperationStart(args.request.operations[0])
      const result = {
        id: 'pdf',
        ok: true,
        path: 'report.pdf',
        format: 'pdf',
        sha256: 'a'.repeat(64),
        pageCount: 1,
        items: [{ kind: 'pdf_page', page: 1, text: 'Hello' }]
      }
      args.onOperationComplete(args.request.operations[0], result)
      return [result]
    })

    const result = await executeLocalProjectToolReply({
      reply: DOCUMENT_REPLY,
      cwd: 'C:\\selected',
      store: {} as never,
      requestId: 'request-document',
      onProgress
    })

    expect(result).toMatchObject({
      kind: 'executed',
      execution: {
        kind: 'local_document',
        operations: [{ id: 'pdf', kind: 'extract', ok: true, target: 'report.pdf' }]
      }
    })
    expect(result.kind === 'executed' ? result.reply : '').toContain(
      '<orca_local_document_results>'
    )
    expect(onProgress).toHaveBeenCalledTimes(2)
  })
})

describe('executeLocalProjectToolReply without a project root', () => {
  it('refuses a command request without raising the approval dialog', async () => {
    const result = await executeLocalProjectToolReply({
      reply: COMMAND_REPLY,
      cwd: '   ',
      store: {} as never,
      requestId: 'request-command'
    })

    expect(approveLocalCommandRequestMock).not.toHaveBeenCalled()
    expect(executeLocalCommandRequestMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'executed',
      execution: {
        kind: 'local_command',
        operations: [{ id: 'a', ok: false, error: 'no local project is selected' }]
      }
    })
  })

  it('refuses a file request the same way', async () => {
    const result = await executeLocalProjectToolReply({
      reply: FILE_REPLY,
      cwd: '',
      store: {} as never,
      requestId: 'request-file'
    })

    expect(executeLocalFileRequestMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'executed',
      execution: {
        kind: 'local_file',
        operations: [{ id: 'a', ok: false, error: 'no local project is selected' }]
      }
    })
  })

  it('allows an attached document to be read without a project root', async () => {
    executeLocalDocumentRequestMock.mockResolvedValue([
      { id: 'pdf', ok: true, path: '@attachments/1-report.pdf', format: 'pdf', pageCount: 1 }
    ])
    const attachments = [{ path: '@attachments/1-report.pdf', artifactId: 'artifact-report' }]
    const result = await executeLocalProjectToolReply({
      reply: ATTACHMENT_DOCUMENT_REPLY,
      cwd: '',
      store: {} as never,
      requestId: 'request-document',
      documentAttachments: attachments
    })

    expect(executeLocalDocumentRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '', attachments })
    )
    expect(result).toMatchObject({
      kind: 'executed',
      execution: {
        kind: 'local_document',
        operations: [{ id: 'pdf', ok: true, target: '@attachments/1-report.pdf' }]
      }
    })
  })

  it('still identifies an ordinary reply as not containing a tool request', async () => {
    await expect(
      executeLocalProjectToolReply({
        reply: 'just a normal answer',
        cwd: '',
        store: {} as never,
        requestId: 'request-none'
      })
    ).resolves.toEqual({ kind: 'none' })
  })
})
