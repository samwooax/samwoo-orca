import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const installerPath = resolve(import.meta.dirname, '../../deploy/install.template.ps1')
const installerBytes = readFileSync(installerPath)
const installer = installerBytes.toString('utf8')

describe('Windows outbound SSH installer contract', () => {
  it('keeps the UTF-8 BOM required by Windows PowerShell 5.1', () => {
    expect([...installerBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('installs only the outbound OpenSSH client', () => {
    expect(installer).toContain('Get-WindowsCapability -Online -Name "OpenSSH.Client*"')
    expect(installer).toContain('Add-WindowsCapability -Online -Name $clientCapability.Name')
    expect(installer).not.toContain('Get-WindowsCapability -Online -Name "OpenSSH.Server*"')
  })

  it('blocks inbound tailnet traffic and disables a legacy SSH server', () => {
    expect(installer).toContain('"--unattended=true", "--shields-up=true"')
    expect(installer).toContain('Stop-Service sshd -Force')
    expect(installer).toContain('Set-Service sshd -StartupType Disabled')
    expect(installer).toContain('Set-NetFirewallRule -Enabled False')
  })

  it('removes only the obsolete Hermes inbound keys', () => {
    expect(installer).toContain('$_ -notmatch "hermes-agent-to-laptop|hermes-ai-center@tailnet"')
    expect(installer).not.toContain('ssh-ed25519 AAAA')
  })

  it('fails verification unless outbound SSH works and inbound SSH is stopped', () => {
    expect(installer).toContain('$sshClientReady -and $sshdStopped -and $sshFirewallDisabled')
    expect(installer).not.toContain('Test-NetConnection')
  })
})
