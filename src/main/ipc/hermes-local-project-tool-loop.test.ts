import { describe, expect, it, vi } from 'vitest'
import { executeLocalProjectToolReply } from './hermes-local-project-tool-loop'

const {
  approveLocalCommandRequestMock,
  executeLocalCommandRequestMock,
  executeLocalFileRequestMock
} = vi.hoisted(() => ({
  approveLocalCommandRequestMock: vi.fn().mockResolvedValue(true),
  executeLocalCommandRequestMock: vi.fn(),
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

const COMMAND_REPLY = `<orca_local_commands>
{"version":1,"operations":[{"id":"a","kind":"run","command":"node","args":["-v"],"mode":"foreground"}]}
</orca_local_commands>`

const FILE_REPLY = `<orca_local_files>
{"version":1,"operations":[{"id":"a","kind":"list","path":"."}]}
</orca_local_files>`

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

  it('rejects replies containing both local tool envelopes', async () => {
    const result = await executeLocalProjectToolReply({
      reply: FILE_REPLY + COMMAND_REPLY,
      cwd: 'C:\\selected',
      store: {} as never,
      requestId: 'request-multiple'
    })

    expect(result).toEqual({
      kind: 'invalid',
      error: 'local tool reply must contain exactly one file or command envelope'
    })
    expect(executeLocalCommandRequestMock).not.toHaveBeenCalled()
    expect(executeLocalFileRequestMock).not.toHaveBeenCalled()
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
