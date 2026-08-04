import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const installerPath = resolve(import.meta.dirname, '../../deploy/install.template.ps1')

describe('Windows one-click package integrity', () => {
  it('verifies every bundled dependency hash before use', async () => {
    const installer = await readFile(installerPath, 'utf8')
    for (const name of [
      'Git-2.55.0.3-64-bit.exe',
      'Git-2.55.0.3-arm64.exe',
      'python-3.14.6-amd64.exe',
      'python-3.14.6-arm64.exe',
      'uv-x86_64-pc-windows-msvc.zip',
      'uv-aarch64-pc-windows-msvc.zip'
    ]) {
      expect(installer).toMatch(new RegExp(`"${name}" = "[a-f0-9]{64}"`))
    }
    expect(installer).toContain('Get-FileHash -LiteralPath $path -Algorithm SHA256')
    expect(installer).toContain('Assert-FileSha256 $gitInstaller')
    expect(installer).toContain('Assert-FileSha256 $pythonInstaller')
    expect(installer).toContain('Assert-FileSha256 $uvArchive')
  })

  it('requires the SAMWOO app installer to carry the expected signer', async () => {
    const installer = await readFile(installerPath, 'utf8')
    expect(installer).toContain('Get-AuthenticodeSignature -LiteralPath $path')
    expect(installer).toContain('CN=SignPath Foundation')
    expect(installer).toContain('Assert-SamwooInstallerSignature $setup')
  })
})
