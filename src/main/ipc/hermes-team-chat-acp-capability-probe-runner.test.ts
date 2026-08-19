import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTeamChatConversation, runTeamChatMessage } from './hermes-team-chat-runner'

const {
  acpFilesystemCreateMock,
  acpTerminalCreateMock,
  executeExcelArtifactToolRequestMock,
  executeLocalFileRequestMock,
  getExcelArtifactCapabilityMock,
  getTeamChatDeviceContextMock,
  hermesAcpSessionMock,
  lstatMock,
  promptMock,
  resolveAuthorizedPathMock,
  spawnMock,
  stopRemoteTeamChatMock
} = vi.hoisted(() => ({
  acpFilesystemCreateMock: vi.fn(),
  acpTerminalCreateMock: vi.fn(),
  executeExcelArtifactToolRequestMock: vi.fn(),
  executeLocalFileRequestMock: vi.fn(),
  getExcelArtifactCapabilityMock: vi.fn(),
  getTeamChatDeviceContextMock: vi.fn(),
  hermesAcpSessionMock: vi.fn(),
  lstatMock: vi.fn(),
  promptMock: vi.fn(),
  resolveAuthorizedPathMock: vi.fn(),
  spawnMock: vi.fn(),
  stopRemoteTeamChatMock: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:fs/promises', () => ({ lstat: lstatMock }))
vi.mock('./filesystem-auth', () => ({ resolveAuthorizedPath: resolveAuthorizedPathMock }))
vi.mock('./hermes-team-chat-acp-client', () => ({ HermesAcpSession: hermesAcpSessionMock }))
vi.mock('./hermes-team-chat-acp-filesystem', () => ({
  HermesAcpFilesystem: { create: acpFilesystemCreateMock }
}))
vi.mock('./hermes-team-chat-acp-terminal', () => ({
  HermesAcpTerminal: { create: acpTerminalCreateMock }
}))
vi.mock('./hermes-team-chat-device-context', () => ({
  getTeamChatDeviceContext: getTeamChatDeviceContextMock,
  formatTeamChatDeviceContext: (context: unknown) => `[작업컨텍스트] ${JSON.stringify(context)}\n`
}))
vi.mock('./hermes-local-project-files', () => ({
  executeLocalFileRequest: executeLocalFileRequestMock
}))
vi.mock('./hermes-excel-artifact-tool-handler', () => ({
  executeExcelArtifactToolRequest: executeExcelArtifactToolRequestMock
}))
vi.mock('./hermes-excel-artifact-worker-client', () => ({
  getExcelArtifactCapability: getExcelArtifactCapabilityMock
}))
vi.mock('./hermes-team-chat-ssh-process', () => ({
  stopRemoteTeamChat: stopRemoteTeamChatMock,
  teamChatSshArgs: (host: string, remote: string) => [host, remote]
}))

function fakeProcess(): EventEmitter & { kill: ReturnType<typeof vi.fn> } {
  const proc = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> }
  proc.kill = vi.fn()
  return proc
}

const baseRequest = {
  host: 'hermes@100.68.242.83',
  profile: 'ai_center',
  modelId: 'gpt-5.5' as const,
  effort: 'medium' as const,
  message: 'read the selected project file',
  imageAttachments: [],
  history: [],
  cwd: 'C:\\selected',
  store: {} as never,
  isDevelopment: true,
  acpCapabilityProbeMode: 'fs'
}

const excelCapability = {
  name: 'excelArtifact' as const,
  protocolVersions: [1],
  actions: ['create', 'modify', 'validate'] as const,
  inputKinds: ['xlsx'] as const,
  executionHosts: ['local'] as const,
  workbookSpecVersions: [1],
  workbookFeatures: ['cells', 'charts'],
  create: { name: 'xlsxwriter', version: '3.2.9', available: true },
  modify: { name: 'openpyxl', version: '3.1.5', available: true },
  validate: { name: 'openpyxl', version: '3.1.5', available: true },
  render: { name: 'libreoffice', version: '26.2.5', available: true },
  pptxInspect: true,
  pdfInspect: true,
  maxInputBytes: 64 * 1024 * 1024,
  maxTimeoutSeconds: 600
}

beforeEach(() => {
  acpFilesystemCreateMock.mockReset().mockResolvedValue({ handle: vi.fn() })
  acpTerminalCreateMock.mockReset().mockResolvedValue({ handle: vi.fn() })
  executeExcelArtifactToolRequestMock.mockReset()
  spawnMock.mockReset().mockReturnValue(fakeProcess())
  executeLocalFileRequestMock.mockReset()
  getExcelArtifactCapabilityMock.mockReset().mockResolvedValue(null)
  getTeamChatDeviceContextMock.mockReset().mockResolvedValue({
    laptopName: 'EMPLOYEE-PC',
    laptopUser: 'employee',
    projectSelected: true
  })
  lstatMock.mockReset().mockResolvedValue({ isDirectory: () => true })
  promptMock.mockReset()
  resolveAuthorizedPathMock.mockReset().mockImplementation(async (cwd: string) => cwd)
  stopRemoteTeamChatMock.mockReset().mockResolvedValue(true)
  hermesAcpSessionMock.mockReset().mockImplementation(function () {
    return {
      prompt: promptMock,
      cancel: vi.fn(() => true),
      close: vi.fn(),
      isClosed: false
    }
  })
})

describe('runTeamChatMessage ACP capability probe', () => {
  it('serves local files and terminal automatically for ai_center', async () => {
    promptMock.mockResolvedValue({ ok: true, reply: 'local files complete' })

    const result = await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-local-files',
      conversationId: 'conversation-local-files',
      acpBackupRoot: 'C:\\private-backups'
    })

    expect(result).toEqual({ ok: true, reply: 'local files complete' })
    expect(acpFilesystemCreateMock).toHaveBeenCalledWith({
      cwd: 'C:\\selected',
      store: baseRequest.store,
      backupRoot: 'C:\\private-backups',
      officePreview: expect.anything()
    })
    expect(acpTerminalCreateMock).toHaveBeenCalledWith({
      cwd: 'C:\\selected',
      store: baseRequest.store
    })
    expect(hermesAcpSessionMock).toHaveBeenCalledWith(expect.anything(), 'ai_center', undefined, {
      capabilityProbe: null,
      localFiles: {
        capability: {
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true
          },
          localTerminal: true,
          projectRoot: 'C:\\selected'
        },
        filesystem: expect.anything(),
        terminal: expect.anything()
      }
    })
    const prompt = String(promptMock.mock.calls[0]?.[0].message)
    expect(prompt).toContain('/workspace')
    expect(prompt).toContain('XLSX and PPTX')
    expect(prompt).not.toMatch(/<\/?orca_/)
    const remote = String(spawnMock.mock.calls[0]?.[1]?.[1])
    expect(remote).toContain('SAMWOO ACP local-files bridge requires Hermes 0.20.0')
    await closeTeamChatConversation('conversation-local-files')
  })

  it('keeps the automatic ai_center capability in packaged builds', async () => {
    promptMock.mockResolvedValue({ ok: true, reply: 'terminal complete' })

    const result = await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-local-terminal',
      conversationId: 'conversation-local-terminal',
      isDevelopment: false,
      acpBackupRoot: 'C:\\private-backups'
    })

    expect(result).toEqual({ ok: true, reply: 'terminal complete' })
    expect(acpTerminalCreateMock).toHaveBeenCalledWith({
      cwd: 'C:\\selected',
      store: baseRequest.store
    })
    expect(hermesAcpSessionMock).toHaveBeenCalledWith(expect.anything(), 'ai_center', undefined, {
      capabilityProbe: null,
      localFiles: {
        capability: {
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true
          },
          localTerminal: true,
          projectRoot: 'C:\\selected'
        },
        filesystem: expect.anything(),
        terminal: expect.anything()
      }
    })
    const prompt = String(promptMock.mock.calls[0]?.[0].message)
    expect(prompt).toContain('Native terminal and process tools')
    expect(prompt).toContain('without a per-command approval dialog')
    expect(prompt).toContain('deletion, moves, renames, search')
    await closeTeamChatConversation('conversation-local-terminal')
  })

  it('keeps the bundled Excel worker available alongside native ACP tools', async () => {
    const request = {
      version: 1,
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-key-0001',
      action: 'create',
      output: { path: 'dashboard.xlsx', overwrite: false, expectedSha256: null },
      workbookSpec: { version: 1, sheets: [{ name: 'Dashboard', state: 'visible' }] },
      validation: { openXml: true, formulas: true, charts: true, renderPreview: false },
      toolchain: { profile: 'excel-artifact-v1', version: '1' },
      timeoutSeconds: 60
    }
    const envelope = `<orca_excel_artifact>${JSON.stringify(request)}</orca_excel_artifact>`
    getExcelArtifactCapabilityMock.mockResolvedValue(excelCapability)
    executeExcelArtifactToolRequestMock.mockResolvedValue({
      reply:
        '<orca_excel_artifact_result>{"version":1,"state":"completed","output":{"path":"dashboard.xlsx"}}</orca_excel_artifact_result>',
      execution: {
        kind: 'excel_artifact',
        operations: [{ id: 'operation-001', kind: 'create', ok: true, target: 'dashboard.xlsx' }]
      }
    })
    promptMock
      .mockResolvedValueOnce({ ok: true, reply: envelope })
      .mockResolvedValueOnce({ ok: true, reply: 'Created dashboard.xlsx with the bundled worker.' })

    const result = await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-acp-excel',
      conversationId: 'conversation-acp-excel',
      acpBackupRoot: 'C:\\private-backups',
      artifactStore: {} as never
    })

    expect(result).toMatchObject({
      ok: true,
      reply: 'Created dashboard.xlsx with the bundled worker.',
      toolExecutions: [{ kind: 'excel_artifact' }]
    })
    expect(String(promptMock.mock.calls[0]?.[0].message)).toContain('[Excel Artifact v1]')
    expect(String(promptMock.mock.calls[0]?.[0].message)).toContain('Do not use terminal Python')
    expect(String(promptMock.mock.calls[1]?.[0].message)).toContain('<orca_excel_artifact_result>')
    expect(executeExcelArtifactToolRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ capability: excelCapability, request })
    )
    await closeTeamChatConversation('conversation-acp-excel')
  })

  it('keeps non-Excel Orca envelopes blocked in the native ACP path', async () => {
    getExcelArtifactCapabilityMock.mockResolvedValue(excelCapability)
    promptMock.mockResolvedValue({
      ok: true,
      reply:
        '<orca_local_files>{"version":1,"operations":[{"id":"read","kind":"read","path":"secret.txt"}]}</orca_local_files>'
    })

    const result = await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-acp-blocked-envelope',
      conversationId: 'conversation-acp-blocked-envelope',
      acpBackupRoot: 'C:\\private-backups',
      artifactStore: {} as never
    })

    expect(result).toEqual({
      ok: false,
      error: 'ACP local tools did not execute the returned Orca tool envelope'
    })
    expect(executeLocalFileRequestMock).not.toHaveBeenCalled()
    await closeTeamChatConversation('conversation-acp-blocked-envelope')
  })

  it('repairs a malformed Excel envelope before executing it', async () => {
    const request = {
      version: 1,
      operationId: 'operation-002',
      idempotencyKey: 'idempotency-key-0002',
      action: 'create',
      output: { path: 'repaired.xlsx', overwrite: false, expectedSha256: null },
      workbookSpec: { version: 1, sheets: [{ name: 'Dashboard', state: 'visible' }] },
      validation: { openXml: true, formulas: true, charts: true, renderPreview: false },
      toolchain: { profile: 'excel-artifact-v1', version: '1' },
      timeoutSeconds: 60
    }
    getExcelArtifactCapabilityMock.mockResolvedValue(excelCapability)
    executeExcelArtifactToolRequestMock.mockResolvedValue({
      reply:
        '<orca_excel_artifact_result>{"version":1,"state":"completed","output":{"path":"repaired.xlsx"}}</orca_excel_artifact_result>',
      execution: {
        kind: 'excel_artifact',
        operations: [{ id: 'operation-002', kind: 'create', ok: true, target: 'repaired.xlsx' }]
      }
    })
    promptMock
      .mockResolvedValueOnce({
        ok: true,
        reply: '<orca_excel_artifact>{"version":1,}</orca_excel_artifact>'
      })
      .mockResolvedValueOnce({
        ok: true,
        reply: `<orca_excel_artifact>${JSON.stringify(request)}</orca_excel_artifact>`
      })
      .mockResolvedValueOnce({ ok: true, reply: 'Created repaired.xlsx.' })

    const result = await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-acp-excel-repair',
      conversationId: 'conversation-acp-excel-repair',
      acpBackupRoot: 'C:\\private-backups',
      artifactStore: {} as never
    })

    expect(result).toMatchObject({ ok: true, reply: 'Created repaired.xlsx.' })
    expect(promptMock).toHaveBeenCalledTimes(3)
    expect(String(promptMock.mock.calls[1]?.[0].message)).toContain(
      'invalid or unsupported Excel Artifact envelope'
    )
    expect(executeExcelArtifactToolRequestMock).toHaveBeenCalledTimes(1)
    await closeTeamChatConversation('conversation-acp-excel-repair')
  })

  it('uses the probe context and capabilities only for ai_center', async () => {
    promptMock.mockResolvedValue({ ok: true, reply: 'probe complete' })

    const result = await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-capability-probe',
      conversationId: 'conversation-capability-probe'
    })

    expect(result).toEqual({ ok: true, reply: 'probe complete' })
    expect(hermesAcpSessionMock).toHaveBeenCalledWith(expect.anything(), 'ai_center', undefined, {
      capabilityProbe: {
        mode: 'fs',
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        sessionCwd: 'C:\\selected'
      }
    })
    const prompt = String(promptMock.mock.calls[0]?.[0].message)
    expect(prompt).toContain('[ACP capability 검증] mode=fs')
    expect(prompt).not.toMatch(/<\/?orca_/)
    expect(resolveAuthorizedPathMock).toHaveBeenCalledWith('C:\\selected', baseRequest.store)
    await closeTeamChatConversation('conversation-capability-probe')
  })

  it('keeps the existing path for another profile', async () => {
    promptMock.mockResolvedValue({ ok: true, reply: 'default complete' })

    await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-another-profile',
      conversationId: 'conversation-another-profile',
      profile: 'hr',
      acpBackupRoot: 'C:\\private-backups'
    })

    expect(hermesAcpSessionMock).toHaveBeenCalledWith(expect.anything(), 'hr', undefined, {
      capabilityProbe: null
    })
    expect(String(promptMock.mock.calls[0]?.[0].message)).toContain('<orca_local_files>')
    expect(resolveAuthorizedPathMock).not.toHaveBeenCalled()
    await closeTeamChatConversation('conversation-another-profile')
  })

  it('keeps the probe off when the local project is not authorized', async () => {
    resolveAuthorizedPathMock.mockRejectedValue(new Error('not authorized'))
    promptMock.mockResolvedValue({ ok: true, reply: 'default complete' })

    await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-unauthorized-project',
      conversationId: 'conversation-unauthorized-project'
    })

    expect(hermesAcpSessionMock).toHaveBeenCalledWith(expect.anything(), 'ai_center', undefined, {
      capabilityProbe: null
    })
    expect(String(promptMock.mock.calls[0]?.[0].message)).toContain('<orca_local_files>')
    await closeTeamChatConversation('conversation-unauthorized-project')
  })

  it('recreates the ACP session when the probe mode is changed or disabled', async () => {
    promptMock.mockResolvedValue({ ok: true, reply: 'complete' })
    const conversationId = 'conversation-probe-mode-change'

    await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-probe-mode-fs',
      conversationId
    })
    await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-probe-mode-terminal',
      conversationId,
      acpCapabilityProbeMode: 'terminal'
    })
    await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-probe-mode-off',
      conversationId,
      acpCapabilityProbeMode: undefined
    })

    expect(hermesAcpSessionMock).toHaveBeenCalledTimes(3)
    expect(hermesAcpSessionMock.mock.calls[0]?.[3].capabilityProbe.mode).toBe('fs')
    expect(hermesAcpSessionMock.mock.calls[1]?.[3].capabilityProbe.mode).toBe('terminal')
    expect(hermesAcpSessionMock.mock.calls[2]?.[3]).toEqual({ capabilityProbe: null })
    expect(stopRemoteTeamChatMock).toHaveBeenCalledTimes(2)
    await closeTeamChatConversation(conversationId)
  })

  it('does not execute a custom envelope returned during the probe', async () => {
    promptMock.mockResolvedValue({
      ok: true,
      reply:
        '<orca_local_files>{"version":1,"operations":[{"id":"read","kind":"read","path":"secret.txt"}]}</orca_local_files>'
    })

    const result = await runTeamChatMessage({
      ...baseRequest,
      requestId: 'request-probe-envelope',
      conversationId: 'conversation-probe-envelope'
    })

    expect(result).toEqual({
      ok: false,
      error: 'ACP capability probe did not execute the returned Orca tool envelope'
    })
    expect(executeLocalFileRequestMock).not.toHaveBeenCalled()
    await closeTeamChatConversation('conversation-probe-envelope')
  })
})
