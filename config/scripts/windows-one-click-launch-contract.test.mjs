import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const installer = readFileSync(
  resolve(import.meta.dirname, '../../deploy/install.template.ps1'),
  'utf8'
)
const launcher = readFileSync(resolve(import.meta.dirname, '../../deploy/install.bat'), 'utf8')

describe('Windows one-click launch contract', () => {
  it('allows the user phase to continue when Windows already elevated the launcher', () => {
    const appInstallIndex = installer.indexOf('Step "SAMWOO-ORCA 앱 설치..."')
    const gitInstallIndex = installer.indexOf('Step "Git $GIT_VERSION 설치..."')
    const pythonInstallIndex = installer.indexOf('Step "Python $PYTHON_VERSION 설치..."')

    expect(appInstallIndex).toBeGreaterThan(0)
    expect(gitInstallIndex).toBeGreaterThan(appInstallIndex)
    expect(pythonInstallIndex).toBeGreaterThan(gitInstallIndex)
    expect(installer).not.toContain('exit 64')
    expect(installer).not.toContain('install.bat을 관리자 권한으로 실행하면 안 됩니다')
  })

  it('requests elevation only when the machine-wide admin phase still needs it', () => {
    expect(installer).toContain('if (-not (Test-IsAdministrator))')
    expect(installer).toContain('$adminStartParameters["Verb"] = "RunAs"')
    expect(installer).toContain('Start-Process @adminStartParameters')
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

  it('closes the launcher on success and pauses only when installation fails', () => {
    expect(launcher).toContain('set "install_exit=%ERRORLEVEL%"')
    expect(launcher).toContain('if not "%install_exit%"=="0" pause')
    expect(launcher).toContain('exit /b %install_exit%')
    expect(launcher.trimEnd()).not.toMatch(/\npause$/)
  })

  it('does not leave the installer console open beside the first app launch', () => {
    const launchSection = installer.slice(installer.indexOf('Step "SAMWOO-ORCA 실행..."'))
    expect(launchSection).toContain('Start-Process -FilePath $installedApp')
    expect(launchSection).not.toContain('Start-Sleep -Seconds 8')
    expect(launchSection).not.toContain('$appProcess.HasExited')
  })
})
