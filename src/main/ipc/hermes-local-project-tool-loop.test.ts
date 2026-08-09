import { describe, expect, it, vi } from 'vitest'

const approveLocalCommandRequest = vi.fn()
const executeLocalCommandRequest = vi.fn()
const executeLocalFileRequest = vi.fn()

vi.mock('./hermes-local-command-approval', () => ({ approveLocalCommandRequest }))
vi.mock('./hermes-local-project-commands', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeLocalCommandRequest
}))
vi.mock('./hermes-local-project-files', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeLocalFileRequest
}))

const { executeLocalProjectToolReply } = await import('./hermes-local-project-tool-loop')

const COMMAND_REPLY = `<orca_local_commands>
{"version":1,"operations":[{"id":"a","kind":"run","command":"node","args":["-v"],"mode":"foreground"}]}
</orca_local_commands>`

const FILE_REPLY = `<orca_local_files>
{"version":1,"operations":[{"id":"a","kind":"list","path":"."}]}
</orca_local_files>`

describe('executeLocalProjectToolReply without a project root', () => {
  it('refuses a command request without raising the approval dialog', async () => {
    const output = await executeLocalProjectToolReply({
      reply: COMMAND_REPLY,
      cwd: '   ',
      store: {} as never,
      requestId: 'req'
    })
    // An unattended scheduled turn must never block on a modal nobody will answer.
    expect(approveLocalCommandRequest).not.toHaveBeenCalled()
    expect(executeLocalCommandRequest).not.toHaveBeenCalled()
    expect(output).toContain('no local project is selected')
  })

  it('refuses a file request the same way', async () => {
    const output = await executeLocalProjectToolReply({
      reply: FILE_REPLY,
      cwd: '',
      store: {} as never,
      requestId: 'req'
    })
    expect(executeLocalFileRequest).not.toHaveBeenCalled()
    expect(output).toContain('no local project is selected')
  })

  it('still returns null when the reply carries no tool request', async () => {
    expect(
      await executeLocalProjectToolReply({
        reply: 'just a normal answer',
        cwd: '',
        store: {} as never,
        requestId: 'req'
      })
    ).toBeNull()
  })
})
