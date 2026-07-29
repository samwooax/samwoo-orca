param(
  [switch]$AdminPhase
)

# SAMWOO-ORCA one-click setup.
# User phase: ORCA + Python + uv. Admin phase: Tailscale + OpenSSH.

$TS_AUTHKEY = "REPLACE_ME"
$AGENT_PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINbxIGjtV1gVl6ccGnGEn9WmS2vLQEi6jyEv1J3JIlFm hermes-agent-to-laptop"
$PYTHON_VERSION = "3.14.6"
$UV_VERSION = "0.12.0"

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $env:TEMP "samwoo-orca-install.log"
try { Start-Transcript -Path $log -Append | Out-Null } catch {}

$results = [ordered]@{}
function Step($message) {
  Write-Host "==> $message" -ForegroundColor Cyan
}
function Ok($key) {
  $script:results[$key] = "OK"
  Write-Host "    [OK] $key" -ForegroundColor Green
}
function Fail($key, $errorMessage) {
  $script:results[$key] = "FAIL: $errorMessage"
  Write-Host "    [FAIL] $key -> $errorMessage" -ForegroundColor Red
}
function Show-Summary {
  Write-Host ""
  Write-Host "======== 설치 요약 ========" -ForegroundColor White
  foreach ($key in $script:results.Keys) {
    $value = $script:results[$key]
    $color = if ($value -eq "OK") { "Green" } else { "Red" }
    Write-Host ("  {0,-18} {1}" -f $key, $value) -ForegroundColor $color
  }
  Write-Host "===========================" -ForegroundColor White
  Write-Host ""
}
function Get-WindowsArchitecture {
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
  } else {
    $env:PROCESSOR_ARCHITECTURE
  }
  if ($architecture -eq "ARM64") {
    return "arm64"
  }
  return "amd64"
}

if (-not $AdminPhase) {
  Write-Host ""
  Write-Host "  사용자 프로그램 설치를 시작합니다. (로그: $log)" -ForegroundColor White
  Write-Host ""

  # Install per-user software before elevation so it lands in the employee profile.
  Step "SAMWOO-ORCA 앱 설치..."
  try {
    $setup = Join-Path $here "samwoo-orca-windows-setup.exe"
    if (-not (Test-Path $setup)) {
      throw "설치 파일이 옆에 없습니다: samwoo-orca-windows-setup.exe"
    }
    taskkill /IM "SAMWOO-ORCA.exe" /F 2>$null | Out-Null
    taskkill /IM "orca.exe" /F 2>$null | Out-Null
    taskkill /IM "orca-terminal-daemon.exe" /F 2>$null | Out-Null
    Start-Sleep -Seconds 2
    $process = Start-Process -FilePath $setup -ArgumentList "/S" -PassThru
    if (-not $process.WaitForExit(180000)) {
      try { $process.Kill() } catch {}
      throw "설치가 3분을 초과했습니다"
    }
    if ($process.ExitCode -ne 0) {
      throw "설치 프로그램 종료 코드: $($process.ExitCode)"
    }
    $installedApp = Join-Path $env:LOCALAPPDATA "Programs\SAMWOO-ORCA\SAMWOO-ORCA.exe"
    if (-not (Test-Path $installedApp)) {
      throw "설치 완료 후 실행 파일을 찾을 수 없습니다: $installedApp"
    }
    Ok "앱 설치"
  } catch {
    Fail "앱 설치" $_
  }

  $architecture = Get-WindowsArchitecture

  Step "Python $PYTHON_VERSION 설치..."
  try {
    $pythonInstaller = Join-Path $here "python-$PYTHON_VERSION-$architecture.exe"
    if (-not (Test-Path $pythonInstaller)) {
      throw "Python 설치 파일이 없습니다: $(Split-Path $pythonInstaller -Leaf)"
    }
    $pythonExe = Join-Path $env:LOCALAPPDATA "Programs\Python\Python314\python.exe"
    $installedVersion = if (Test-Path $pythonExe) {
      (& $pythonExe --version 2>&1 | Out-String).Trim()
    } else {
      ""
    }
    if ($installedVersion -ne "Python $PYTHON_VERSION") {
      $pythonArgs = @(
        "/quiet",
        "InstallAllUsers=0",
        "PrependPath=1",
        "Include_test=0",
        "Include_launcher=1",
        "InstallLauncherAllUsers=0",
        "Shortcuts=0"
      )
      $pythonProcess = Start-Process -FilePath $pythonInstaller -ArgumentList $pythonArgs -PassThru -Wait
      if ($pythonProcess.ExitCode -ne 0) {
        throw "Python 설치 프로그램 종료 코드: $($pythonProcess.ExitCode)"
      }
    }
    if (-not (Test-Path $pythonExe)) {
      throw "Python 실행 파일을 찾을 수 없습니다: $pythonExe"
    }
    $verifiedPython = (& $pythonExe --version 2>&1 | Out-String).Trim()
    if ($verifiedPython -ne "Python $PYTHON_VERSION") {
      throw "Python 버전 확인 실패: $verifiedPython"
    }
    Ok "Python $PYTHON_VERSION"
  } catch {
    Fail "Python $PYTHON_VERSION" $_
  }

  Step "uv $UV_VERSION 설치..."
  try {
    $uvArchiveName = if ($architecture -eq "arm64") {
      "uv-aarch64-pc-windows-msvc.zip"
    } else {
      "uv-x86_64-pc-windows-msvc.zip"
    }
    $uvArchive = Join-Path $here $uvArchiveName
    if (-not (Test-Path $uvArchive)) {
      throw "uv 설치 파일이 없습니다: $uvArchiveName"
    }
    $uvDir = Join-Path $env:LOCALAPPDATA "Programs\uv"
    $uvTemp = Join-Path $env:TEMP "samwoo-uv-$UV_VERSION-$architecture"
    if (Test-Path $uvTemp) {
      Remove-Item $uvTemp -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $uvTemp, $uvDir | Out-Null
    Expand-Archive -Path $uvArchive -DestinationPath $uvTemp -Force
    foreach ($binaryName in @("uv.exe", "uvx.exe", "uvw.exe")) {
      $sourceBinary = Get-ChildItem $uvTemp -Recurse -File -Filter $binaryName |
        Select-Object -First 1
      if ($sourceBinary) {
        Copy-Item $sourceBinary.FullName (Join-Path $uvDir $binaryName) -Force
      }
    }
    $uvExe = Join-Path $uvDir "uv.exe"
    if (-not (Test-Path $uvExe)) {
      throw "uv.exe를 찾을 수 없습니다"
    }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathEntries = @($userPath -split ";" | Where-Object { $_ })
    if ($pathEntries -notcontains $uvDir) {
      $newUserPath = (($pathEntries + $uvDir) -join ";")
      [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    }
    $env:Path = "$uvDir;$env:Path"
    $verifiedUv = (& $uvExe --version 2>&1 | Out-String).Trim()
    $uvVersionPattern = "^uv " + [regex]::Escape($UV_VERSION) + "(\s|$)"
    if ($verifiedUv -notmatch $uvVersionPattern) {
      throw "uv 버전 확인 실패: $verifiedUv"
    }
    Remove-Item $uvTemp -Recurse -Force
    Ok "uv $UV_VERSION"
  } catch {
    Fail "uv $UV_VERSION" $_
  }

  Show-Summary
  $userPhaseFailed = @($results.Values | Where-Object { $_ -ne "OK" }).Count -gt 0
  Step "Tailscale와 OpenSSH 설치를 위한 관리자 권한 요청..."
  $adminPhaseFailed = $false
  try {
    $adminProcess = Start-Process powershell -Verb RunAs -PassThru -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "`"$($MyInvocation.MyCommand.Path)`"",
      "-AdminPhase"
    )
    $adminProcess.WaitForExit()
    if ($adminProcess.ExitCode -ne 0) {
      $adminPhaseFailed = $true
      throw "관리자 설치 단계 종료 코드: $($adminProcess.ExitCode)"
    }
  } catch {
    $adminPhaseFailed = $true
    Fail "관리자 설치 단계" $_
    Show-Summary
  }
  try { Stop-Transcript | Out-Null } catch {}
  if ($userPhaseFailed -or $adminPhaseFailed) {
    exit 1
  }
  exit 0
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "관리자 권한이 필요합니다." -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}

Write-Host ""
Write-Host "  시스템 연결 구성요소를 설치합니다. (로그: $log)" -ForegroundColor White
Write-Host ""

Step "Tailscale 설치..."
$tailscaleExe = "$env:ProgramFiles\Tailscale\tailscale.exe"
try {
  if (-not (Test-Path $tailscaleExe)) {
    $tailscaleMsi = Join-Path $here "tailscale-setup.msi"
    if (-not (Test-Path $tailscaleMsi)) {
      $tailscaleMsi = Join-Path $env:TEMP "tailscale-setup.msi"
      Invoke-WebRequest -UseBasicParsing `
        -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi" `
        -OutFile $tailscaleMsi
    }
    $tailscaleProcess = Start-Process msiexec.exe `
      -ArgumentList "/i", "`"$tailscaleMsi`"", "/qn" -PassThru -Wait
    if ($tailscaleProcess.ExitCode -ne 0) {
      throw "Tailscale 설치 프로그램 종료 코드: $($tailscaleProcess.ExitCode)"
    }
  }
  if (-not (Test-Path $tailscaleExe)) {
    throw "Tailscale 실행 파일을 찾을 수 없습니다"
  }
  Ok "Tailscale 설치"
} catch {
  Fail "Tailscale 설치" $_
}

Step "Tailscale 네트워크 합류..."
try {
  if ($TS_AUTHKEY -like "*REPLACE_ME*") {
    throw "인증 키가 설정되지 않았습니다"
  }
  if (-not (Test-Path $tailscaleExe)) {
    throw "Tailscale이 설치되지 않았습니다"
  }
  & $tailscaleExe up --authkey=$TS_AUTHKEY --unattended 2>&1 | Out-Null
  Start-Sleep -Seconds 3
  $tailscaleIp = (& $tailscaleExe ip -4 2>$null | Select-Object -First 1)
  if (-not $tailscaleIp) {
    throw "테일넷 IP가 할당되지 않았습니다"
  }
  Ok "테일넷 합류 ($tailscaleIp)"
} catch {
  Fail "테일넷 합류" $_
}

Step "OpenSSH 서버 설치..."
$sshInstalled = $false
try {
  $localZip = Join-Path $here "OpenSSH-Win64.zip"
  if (Test-Path "$env:ProgramFiles\OpenSSH\sshd.exe") {
    $sshInstalled = $true
  }
  if (-not $sshInstalled -and (Test-Path $localZip)) {
    $sshZip = $localZip
  }
  if (-not $sshInstalled -and -not (Test-Path $localZip)) {
    $capability = Get-WindowsCapability -Online -Name "OpenSSH.Server*" `
      -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($capability -and $capability.State -eq "Installed") {
      $sshInstalled = $true
    } elseif ($capability) {
      try {
        Add-WindowsCapability -Online -Name $capability.Name -ErrorAction Stop | Out-Null
        $sshInstalled = $true
      } catch {}
    }
    if (-not $sshInstalled) {
      $sshZip = Join-Path $env:TEMP "OpenSSH-Win64.zip"
      $release = Invoke-RestMethod -UseBasicParsing `
        "https://api.github.com/repos/PowerShell/Win32-OpenSSH/releases/latest"
      $downloadUrl = ($release.assets |
        Where-Object { $_.name -eq "OpenSSH-Win64.zip" }).browser_download_url
      Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $sshZip
    }
  }
  if (-not $sshInstalled -and $sshZip -and (Test-Path $sshZip)) {
    $sshTemp = "$env:ProgramFiles\OpenSSH-tmp"
    if (Test-Path $sshTemp) {
      Remove-Item $sshTemp -Recurse -Force
    }
    Expand-Archive -Path $sshZip -DestinationPath $sshTemp -Force
    $sourceDir = Get-ChildItem $sshTemp -Directory | Select-Object -First 1
    if (-not $sourceDir) {
      throw "OpenSSH 압축 구조를 확인할 수 없습니다"
    }
    if (Test-Path "$env:ProgramFiles\OpenSSH") {
      Remove-Item "$env:ProgramFiles\OpenSSH" -Recurse -Force
    }
    Move-Item $sourceDir.FullName "$env:ProgramFiles\OpenSSH"
    Remove-Item $sshTemp -Recurse -Force
    & powershell -ExecutionPolicy Bypass `
      -File "$env:ProgramFiles\OpenSSH\install-sshd.ps1" | Out-Null
    $sshInstalled = $true
  }
  if (-not $sshInstalled -and (Test-Path "$env:ProgramFiles\OpenSSH\sshd.exe")) {
    $sshInstalled = $true
  }
  if (-not $sshInstalled) {
    throw "OpenSSH 설치 실패"
  }
  Ok "OpenSSH 설치"
} catch {
  Fail "OpenSSH 설치" $_
}

Step "OpenSSH 서비스 시작..."
try {
  Set-Service -Name sshd -StartupType Automatic -ErrorAction Stop
  Start-Service sshd -ErrorAction Stop
  if (-not (Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" `
      -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" `
      -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound `
      -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
  }
  Ok "sshd 서비스"
} catch {
  Fail "sshd 서비스" $_
}

Step "에이전트 접근 키 등록..."
try {
  $adminKeys = Join-Path $env:ProgramData "ssh\administrators_authorized_keys"
  New-Item -ItemType Directory -Force -Path (Split-Path $adminKeys) | Out-Null
  $currentKeys = if (Test-Path $adminKeys) {
    Get-Content $adminKeys -Raw
  } else {
    ""
  }
  if ($currentKeys -notlike "*$AGENT_PUBKEY*") {
    Add-Content -Path $adminKeys -Value $AGENT_PUBKEY
  }
  icacls $adminKeys /inheritance:r | Out-Null
  icacls $adminKeys /grant "Administrators:F" "SYSTEM:F" | Out-Null
  Ok "키 등록"
} catch {
  Fail "키 등록" $_
}

Start-Sleep -Seconds 2
$sshdRunning = (Get-Service sshd -ErrorAction SilentlyContinue).Status -eq "Running"
$portOpen = $false
try {
  $portOpen = (Test-NetConnection -ComputerName 127.0.0.1 -Port 22 `
    -WarningAction SilentlyContinue).TcpTestSucceeded
} catch {}
if ($sshdRunning -and $portOpen) {
  Ok "OpenSSH 확인"
} else {
  Fail "OpenSSH 확인" "sshd 또는 포트 22가 준비되지 않았습니다"
}

Show-Summary
$adminPhaseFailed = @($results.Values | Where-Object { $_ -ne "OK" }).Count -gt 0
try { Stop-Transcript | Out-Null } catch {}
Read-Host "이 창을 닫으려면 Enter를 누르세요"
if ($adminPhaseFailed) {
  exit 1
}
exit 0
