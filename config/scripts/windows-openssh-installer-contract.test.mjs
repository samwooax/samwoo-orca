import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const installer = readFileSync(
  resolve(import.meta.dirname, '../../deploy/install.template.ps1'),
  'utf8'
)

describe('Windows OpenSSH installer contract', () => {
  it('registers both Hermes server identities for administrator accounts', () => {
    expect(installer).toContain(
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINbxIGjtV1gVl6ccGnGEn9WmS2vLQEi6jyEv1J3JIlFm hermes-agent-to-laptop'
    )
    expect(installer).toContain(
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKE28Gc09ExBTFEG84oaeT6FIM3k5Z+7wCHIzlKFor/L hermes-ai-center@tailnet'
    )
    expect(installer).toContain('$currentKeyLines -notcontains $agentPublicKey')
  })

  it('uses the Windows administrator key location with locale-independent ACLs', () => {
    expect(installer).toContain('ssh\\administrators_authorized_keys')
    expect(installer).toContain(
      'AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys'
    )
    expect(installer).toContain('"*S-1-5-32-544:F" "*S-1-5-18:F"')
    expect(installer).not.toContain('"Administrators:F" "SYSTEM:F"')
  })

  it('fails verification unless sshd, port 22, config, and both keys are ready', () => {
    expect(installer).toContain('$sshdRunning -and $portOpen -and $allKeysRegistered -and')
    expect(installer).toContain('$administratorConfigReady')
  })
})
