import { describe, expect, it } from 'vitest'
import {
  formatHermesAcpCapabilityProbeContext,
  formatHermesAcpCapabilityProbeLog,
  hasOrcaToolEnvelope,
  isHermesAcpClientMethod,
  resolveHermesAcpCapabilityProbe
} from './hermes-team-chat-acp-capability-probe'

describe('Hermes ACP capability probe', () => {
  it('enables standard fs capabilities only for the ai_center development profile', () => {
    expect(
      resolveHermesAcpCapabilityProbe({
        profile: 'ai_center',
        isDevelopment: true,
        requestedMode: 'fs',
        sessionCwd: 'C:\\selected'
      })
    ).toEqual({
      mode: 'fs',
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      sessionCwd: 'C:\\selected'
    })
  })

  it('supports an isolated terminal probe', () => {
    expect(
      resolveHermesAcpCapabilityProbe({
        profile: 'ai_center',
        isDevelopment: true,
        requestedMode: 'terminal',
        sessionCwd: '/home/employee/project'
      })
    ).toEqual({
      mode: 'terminal',
      clientCapabilities: { terminal: true },
      sessionCwd: '/home/employee/project'
    })
  })

  it.each([
    ['packaged ai_center', 'ai_center', false, 'fs', 'C:\\selected'],
    ['another profile', 'hr', true, 'fs', 'C:\\selected'],
    ['similar profile', 'ai_center_backup', true, 'terminal', 'C:\\selected'],
    ['missing flag', 'ai_center', true, undefined, 'C:\\selected'],
    ['unknown flag', 'ai_center', true, 'both', 'C:\\selected'],
    ['missing project', 'ai_center', true, 'fs', '']
  ])(
    'keeps the probe disabled for %s',
    (_label, profile, isDevelopment, requestedMode, sessionCwd) => {
      expect(
        resolveHermesAcpCapabilityProbe({
          profile,
          isDevelopment,
          requestedMode,
          sessionCwd
        })
      ).toBeNull()
    }
  )

  it('formats a probe-only prompt without the custom tool protocol', () => {
    const context = formatHermesAcpCapabilityProbeContext(
      { laptopName: 'PC', laptopUser: 'employee', projectSelected: true },
      'fs'
    )

    expect(context).toContain('[ACP capability 검증] mode=fs')
    expect(context).not.toMatch(/<\/?orca_/)
  })

  it('logs capability metadata without file paths, prompts, commands, or content', () => {
    const initialize = formatHermesAcpCapabilityProbeLog({
      direction: 'client_to_agent',
      profile: 'ai_center',
      mode: 'fs',
      message: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          prompt: 'prompt-secret',
          cwd: 'C:\\private\\project'
        }
      }
    })
    const clientRequest = formatHermesAcpCapabilityProbeLog({
      direction: 'agent_to_client',
      profile: 'ai_center',
      mode: 'fs',
      message: {
        jsonrpc: '2.0',
        id: 2,
        method: 'fs/read_text_file',
        params: { path: 'C:\\private\\project\\secret.txt', content: 'file-secret' }
      }
    })
    const initializeResponse = formatHermesAcpCapabilityProbeLog({
      direction: 'agent_to_client',
      profile: 'ai_center',
      mode: 'fs',
      responseTo: 'initialize',
      message: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            diagnostic: { path: '/private/root', content: 'capability-secret' },
            _meta: { note: 'meta-secret' }
          }
        }
      }
    })
    const malformedMetadata = formatHermesAcpCapabilityProbeLog({
      direction: 'agent_to_client',
      profile: 'ai_center',
      mode: 'terminal',
      message: {
        jsonrpc: '2.0',
        id: 'id-secret',
        method: 'terminal/create/private-secret',
        params: {}
      }
    })

    expect(initialize).toContain('readTextFile')
    expect(clientRequest).toContain('fs/read_text_file')
    expect(initializeResponse).toContain('loadSession')
    expect(malformedMetadata).toContain('"idType":"string"')
    expect(malformedMetadata).toContain('"method":"[redacted]"')
    expect(
      `${initialize}\n${clientRequest}\n${initializeResponse}\n${malformedMetadata}`
    ).not.toMatch(
      /prompt-secret|private|secret\.txt|file-secret|capability-secret|meta-secret|id-secret/
    )
  })

  it('recognizes client methods and custom envelopes', () => {
    expect(isHermesAcpClientMethod('fs/read_text_file')).toBe(true)
    expect(isHermesAcpClientMethod('fs/write_text_file')).toBe(true)
    for (const method of [
      'terminal/create',
      'terminal/output',
      'terminal/wait_for_exit',
      'terminal/kill',
      'terminal/release'
    ]) {
      expect(isHermesAcpClientMethod(method)).toBe(true)
    }
    expect(isHermesAcpClientMethod('session/update')).toBe(false)
    expect(hasOrcaToolEnvelope('<orca_local_files>{}</orca_local_files>')).toBe(true)
    expect(hasOrcaToolEnvelope('plain response')).toBe(false)
  })
})
