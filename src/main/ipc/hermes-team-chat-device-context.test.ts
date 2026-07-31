import { describe, expect, it } from 'vitest'
import {
  formatTeamChatDeviceContext,
  parseTeamChatTailscaleIdentity
} from './hermes-team-chat-device-context'

describe('team chat device context', () => {
  it('reads the current Windows node and IPv4 from Tailscale self status', () => {
    expect(
      parseTeamChatTailscaleIdentity(
        JSON.stringify({
          Self: {
            HostName: 'DESKTOP-NEW',
            TailscaleIPs: ['fd7a:115c:a1e0::1', '100.91.175.83']
          }
        })
      )
    ).toEqual({
      laptopName: 'DESKTOP-NEW',
      tailscaleIpv4: '100.91.175.83'
    })
  })

  it('does not invent an identity from malformed status output', () => {
    expect(parseTeamChatTailscaleIdentity('not-json')).toEqual({
      laptopName: '',
      tailscaleIpv4: ''
    })
  })

  it('binds laptop work to the current Tailscale IPv4', () => {
    const context = formatTeamChatDeviceContext({
      laptopName: 'DESKTOP-NEW',
      laptopUser: 'employee',
      tailscaleIpv4: '100.91.175.83',
      cwd: 'C:\\work'
    })

    expect(context).toContain('"tailscaleIpv4":"100.91.175.83"')
    expect(context).toContain('이 IP에만 수행')
    expect(context).toContain('다른 장비 IP는 사용하지 마세요')
  })

  it('forbids laptop access when the current IP is unavailable', () => {
    const context = formatTeamChatDeviceContext({
      laptopName: '',
      laptopUser: 'employee',
      tailscaleIpv4: '',
      cwd: 'C:\\work'
    })

    expect(context).toContain('어떤 노트북에도 SSH하거나 원격 파일 작업을 수행하지 마세요')
  })
})
