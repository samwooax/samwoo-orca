import { describe, expect, it } from 'vitest'
import { isValidTeamChatSshHost, teamChatSshArgs } from './hermes-team-chat-ssh-process'

describe('team chat SSH process', () => {
  it('rejects hosts that could be interpreted as SSH options', () => {
    expect(isValidTeamChatSshHost('-oProxyCommand=payload')).toBe(false)
    expect(isValidTeamChatSshHost('hermes@100.68.242.83')).toBe(true)
    expect(isValidTeamChatSshHost('qn6c')).toBe(true)
  })

  it('places the validated host after all SSH options', () => {
    const args = teamChatSshArgs('hermes@host', 'remote command')
    const hostIndex = args.indexOf('hermes@host')

    expect(hostIndex).toBeGreaterThan(0)
    expect(args.slice(hostIndex)).toEqual(['hermes@host', 'remote command'])
    if (process.platform !== 'win32') {
      const controlPath = args.find((arg) => arg.startsWith('ControlPath='))
      expect(controlPath).toContain('samwoo-orca-ssh-')
      expect(controlPath).not.toContain('ControlPath=/tmp/.samwoo-orca-ssh')
    }
  })
})
