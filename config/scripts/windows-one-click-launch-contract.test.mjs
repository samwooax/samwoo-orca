import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const installer = readFileSync(
  resolve(import.meta.dirname, '../../deploy/install.template.ps1'),
  'utf8'
)

describe('Windows one-click launch contract', () => {
  it('blocks an elevated user phase before installing any user software', () => {
    const guardIndex = installer.indexOf('if (Test-IsAdministrator)')
    const appInstallIndex = installer.indexOf('Step "SAMWOO-ORCA 앱 설치..."')
    const gitInstallIndex = installer.indexOf('Step "Git $GIT_VERSION 설치..."')
    const pythonInstallIndex = installer.indexOf('Step "Python $PYTHON_VERSION 설치..."')

    expect(guardIndex).toBeGreaterThan(0)
    expect(guardIndex).toBeLessThan(appInstallIndex)
    expect(guardIndex).toBeLessThan(gitInstallIndex)
    expect(guardIndex).toBeLessThan(pythonInstallIndex)
    expect(installer).toContain('exit 64')
    expect(installer).toContain('install.bat을 일반 더블클릭하세요')
  })

  it('keeps elevation scoped to the machine-wide admin phase', () => {
    expect(installer).toContain('Start-Process powershell -Verb RunAs')
    expect(installer).toContain('"-AdminPhase"')
  })

  it('installs the matching Git for Windows build only when Git is unavailable', () => {
    expect(installer).toContain('Get-Command git.exe -ErrorAction SilentlyContinue')
    expect(installer).toContain('"Git-$GIT_INSTALLER_VERSION-arm64.exe"')
    expect(installer).toContain('"Git-$GIT_INSTALLER_VERSION-64-bit.exe"')
    expect(installer).toContain('"/VERYSILENT"')
    expect(installer).toContain('"/CURRENTUSER"')
    expect(installer).toContain('$gitProcess.WaitForExit(300000)')
    expect(installer).toContain('if ($installedGit -notmatch "^git version ")')
  })
})
