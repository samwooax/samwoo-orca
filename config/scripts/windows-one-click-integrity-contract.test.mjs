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
    expect(installer).toContain('Assert-FileSha256 $bundledPath')
    expect(installer).toContain('Assert-FileSha256 $cachedPath')
    expect(installer).toContain('Assert-FileSha256 $partialPath $name')
  })

  it('downloads missing Git, Python and uv packages from pinned official URLs', async () => {
    const installer = await readFile(installerPath, 'utf8')
    expect(installer).toContain('https://github.com/git-for-windows/git/releases/download/')
    expect(installer).toContain('https://www.python.org/ftp/python/')
    expect(installer).toContain('https://github.com/astral-sh/uv/releases/download/')
    expect(installer).toContain('Invoke-WebRequest -UseBasicParsing -Uri $packageUrl')
    expect(installer).toContain('$gitInstaller = Get-VerifiedPackage $gitInstallerName')
    expect(installer).toContain('$pythonInstaller = Get-VerifiedPackage $pythonInstallerName')
    expect(installer).toContain('$uvArchive = Get-VerifiedPackage $uvArchiveName')
  })

  it('requires the SAMWOO app installer to carry the expected signer', async () => {
    const installer = await readFile(installerPath, 'utf8')
    expect(installer).toContain('Get-AuthenticodeSignature -LiteralPath $path')
    expect(installer).toContain('81316CB47930717E9EB6949430BD80C2F4E6166D')
    expect(installer).toContain('Install-SamwooPublisherTrust')
    expect(installer).toContain('Add-SamwooCertificateToStore')
    expect(installer).toContain('StoreName]::Root')
    expect(installer).toContain('StoreName]::TrustedPublisher')
    expect(installer).toContain('StoreLocation]::LocalMachine')
    expect(installer).toContain('Assert-SamwooInstallerSignature $setup')
  })

  it('requires the Tailscale installer to carry its expected publisher signature', async () => {
    const installer = await readFile(installerPath, 'utf8')
    expect(installer).toContain(
      'Assert-TrustedPublisherSignature $tailscaleMsi "CN=Tailscale Inc."'
    )
  })
})
