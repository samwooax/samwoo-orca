import { describe, expect, it } from 'vitest'
import { formatTeamChatDeviceContext } from './hermes-team-chat-device-context'

describe('team chat device context', () => {
  it('identifies the local project without exposing an inbound network target', () => {
    const context = formatTeamChatDeviceContext({
      laptopName: 'DESKTOP-NEW',
      laptopUser: 'employee',
      projectSelected: true
    })

    expect(context).toContain('"laptopName":"DESKTOP-NEW"')
    expect(context).toContain('"projectSelected":true')
    expect(context).not.toContain('C:\\\\work')
    expect(context).not.toContain('tailscaleIpv4')
  })

  it('requires all project access to use the local file protocol', () => {
    const context = formatTeamChatDeviceContext({
      laptopName: 'DESKTOP-NEW',
      laptopUser: 'employee',
      projectSelected: true
    })

    expect(context).toContain('노트북으로 SSH하거나 네트워크로 직접 접속하지 마세요')
    expect(context).toContain('Orca 로컬파일도구로만 요청하세요')
  })
})
