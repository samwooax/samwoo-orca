param(
  [switch]$AdminPhase
)

# SAMWOO-ORCA one-click setup.
# User phase: ORCA + Git + Python + uv. Admin phase: Tailscale + outbound SSH client.

$TS_AUTHKEY = "REPLACE_ME"
$TS_TAILNET = "samwooax.github"
$GIT_VERSION = "2.55.0.windows.3"
$GIT_INSTALLER_VERSION = "2.55.0.3"
$PYTHON_VERSION = "3.14.6"
$UV_VERSION = "0.12.0"
$SAMWOO_SIGNER_THUMBPRINT = "81316CB47930717E9EB6949430BD80C2F4E6166D"
$SAMWOO_ROOT_CERT_SHA256 = "1dff110f0759f0c43b630f11ed7ca0430e1683fc7848af1e4b9581ea7b869c0f"
$SAMWOO_PUBLISHER_CERT_SHA256 = "f5a6c3ec726645403edbb7b81cff1e32df817e40936a49ee14aa30c39cfe09ae"
$PACKAGE_SHA256 = @{
  "Git-2.55.0.3-64-bit.exe" = "af12577d0fdff74243a5988197aa49b957d5044edc17004f6ddf0768996f1dca"
  "Git-2.55.0.3-arm64.exe" = "e3d7f5a2214f214f0a93cf0d8915dab236a0e91c7de6de70a7dbde9a61c794db"
  "python-3.14.6-amd64.exe" = "14b3e9a710a3fcf0bd9b55ab6b60412bd91227563f813fc49040cabc0209e0bd"
  "python-3.14.6-arm64.exe" = "517412448c44f0583c994723640e208ca82723e340b0cb6a667696ba2eea63fc"
  "uv-x86_64-pc-windows-msvc.zip" = "68200e25de594df92387186bbfb9d9df606ec1d87efaa0ae0c7f690970e53db6"
  "uv-aarch64-pc-windows-msvc.zip" = "60c12dc34a8ff0269d7744a3a94506fa8f140618a82194b7bf7834fa789a765b"
}

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
function Assert-FileSha256($path) {
  $name = Split-Path $path -Leaf
  $expected = $PACKAGE_SHA256[$name]
  if (-not $expected) {
    throw "SHA256 기준값이 없습니다: $name"
  }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "파일 SHA256 불일치: $name"
  }
}
function Assert-SamwooInstallerSignature($path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne "Valid") {
    throw "SAMWOO-ORCA 설치 파일의 코드 서명이 유효하지 않습니다: $($signature.Status)"
  }
  if ($signature.SignerCertificate.Thumbprint -ne $SAMWOO_SIGNER_THUMBPRINT) {
    throw "SAMWOO-ORCA 설치 파일 서명자가 올바르지 않습니다: $($signature.SignerCertificate.Subject)"
  }
}
function Add-SamwooCertificateToCurrentUserStore($path, $storeName) {
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($path)
  $store = [Security.Cryptography.X509Certificates.X509Store]::new(
    $storeName,
    [Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
  )
  try {
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($certificate)
  } finally {
    $store.Close()
    $certificate.Dispose()
  }
}
function Install-SamwooPublisherTrust {
  $rootCertificate = Join-Path $here "samwoo-internal-root-ca.cer"
  $publisherCertificate = Join-Path $here "samwoo-internal-code-signing.cer"
  if (-not (Test-Path $rootCertificate) -or -not (Test-Path $publisherCertificate)) {
    throw "SAMWOO 코드서명 공개 인증서가 설치 키트에 없습니다"
  }
  $rootHash = (Get-FileHash -LiteralPath $rootCertificate -Algorithm SHA256).Hash.ToLowerInvariant()
  $publisherHash = (Get-FileHash -LiteralPath $publisherCertificate -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($rootHash -ne $SAMWOO_ROOT_CERT_SHA256 -or $publisherHash -ne $SAMWOO_PUBLISHER_CERT_SHA256) {
    throw "SAMWOO 코드서명 공개 인증서의 무결성 검증에 실패했습니다"
  }
  $publisher = [Security.Cryptography.X509Certificates.X509Certificate2]::new($publisherCertificate)
  if ($publisher.Thumbprint -ne $SAMWOO_SIGNER_THUMBPRINT) {
    throw "SAMWOO 코드서명 인증서 지문이 올바르지 않습니다"
  }
  Add-SamwooCertificateToCurrentUserStore $rootCertificate `
    ([Security.Cryptography.X509Certificates.StoreName]::Root)
  Add-SamwooCertificateToCurrentUserStore $publisherCertificate `
    ([Security.Cryptography.X509Certificates.StoreName]::TrustedPublisher)
}
function Assert-TrustedPublisherSignature($path, $publisherName) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne "Valid") {
    throw "설치 파일의 코드 서명이 유효하지 않습니다: $($signature.Status)"
  }
  if ($signature.SignerCertificate.Subject -notlike "*$publisherName*") {
    throw "설치 파일 서명자가 올바르지 않습니다: $($signature.SignerCertificate.Subject)"
  }
}
function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}
function Get-AdminPhaseRequirements {
  $tailscaleExe = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (-not (Test-Path $tailscaleExe)) {
    Write-Output "Tailscale 설치"
  } else {
    try {
      $profileText = (& $tailscaleExe switch --list 2>$null | Out-String)
      $activeProfile = @($profileText -split "\r?\n") |
        Where-Object { $_.TrimEnd().EndsWith("*") } |
        Select-Object -First 1
      if ($activeProfile -notmatch [regex]::Escape($TS_TAILNET)) {
        Write-Output "SAMWOO 테일넷 연결"
      }
      $tailscaleIp = (& $tailscaleExe ip -4 2>$null | Select-Object -First 1)
      if (-not $tailscaleIp) {
        Write-Output "테일넷 IP 할당"
      }
    } catch {
      Write-Output "Tailscale 연결 상태 확인"
    }
  }

  $sshExe = Join-Path $env:WINDIR "System32\OpenSSH\ssh.exe"
  if (-not (Test-Path $sshExe)) {
    Write-Output "OpenSSH 클라이언트 설치"
  }

  $sshdService = Get-Service sshd -ErrorAction SilentlyContinue
  if ($sshdService -and $sshdService.Status -ne "Stopped") {
    Write-Output "OpenSSH 서버 중지"
  }
  if ($sshdService) {
    try {
      $sshdConfig = Get-CimInstance Win32_Service -Filter "Name='sshd'" -ErrorAction Stop
      if ($sshdConfig.StartMode -ne "Disabled") {
        Write-Output "OpenSSH 서버 자동 시작 차단"
      }
    } catch {
      Write-Output "OpenSSH 서버 시작 상태 확인"
    }
  }

  try {
    $sshFirewallRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" `
      -ErrorAction SilentlyContinue
    if (@($sshFirewallRule | Where-Object { $_.Enabled -eq "True" }).Count -gt 0) {
      Write-Output "OpenSSH 인바운드 방화벽 차단"
    }
  } catch {
    Write-Output "OpenSSH 방화벽 상태 확인"
  }

  $adminKeys = Join-Path $env:ProgramData "ssh\administrators_authorized_keys"
  if (Test-Path $adminKeys) {
    try {
      $serverKeys = @(Get-Content $adminKeys -ErrorAction Stop | Where-Object {
        $_ -match "hermes-agent-to-laptop|hermes-ai-center@tailnet"
      })
      if ($serverKeys.Count -gt 0) {
        Write-Output "서버의 노트북 접근 키 제거"
      }
    } catch {
      Write-Output "SSH 관리자 키 상태 확인"
    }
  }
}

if (-not $AdminPhase) {
  if (Test-IsAdministrator) {
    Write-Host ""
    Write-Host "  [중지] install.bat을 관리자 권한으로 실행하면 안 됩니다." `
      -ForegroundColor Red
    Write-Host "  이 창을 닫고 install.bat을 일반 더블클릭하세요." `
      -ForegroundColor Yellow
    Write-Host "  필요한 관리자 권한은 설치 도중 별도로 요청됩니다." `
      -ForegroundColor Yellow
    Write-Host ""
    try { Stop-Transcript | Out-Null } catch {}
    exit 64
  }

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
    Install-SamwooPublisherTrust
    Assert-SamwooInstallerSignature $setup
    Get-Process "SAMWOO-ORCA", "samwoo-orca-terminal-daemon" `
      -ErrorAction SilentlyContinue | Stop-Process -Force
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

  Step "Git $GIT_VERSION 설치..."
  try {
    $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue |
      Select-Object -First 1
    $gitExe = if ($gitCommand) { $gitCommand.Source } else { $null }
    $installedGit = if ($gitExe -and (Test-Path $gitExe)) {
      (& $gitExe --version 2>&1 | Out-String).Trim()
    } else {
      ""
    }
    if ($installedGit -notmatch "^git version ") {
      $gitInstallerName = if ($architecture -eq "arm64") {
        "Git-$GIT_INSTALLER_VERSION-arm64.exe"
      } else {
        "Git-$GIT_INSTALLER_VERSION-64-bit.exe"
      }
      $gitInstaller = Join-Path $here $gitInstallerName
      if (-not (Test-Path $gitInstaller)) {
        throw "Git 설치 파일이 없습니다: $gitInstallerName"
      }
      Assert-FileSha256 $gitInstaller
      $gitProcess = Start-Process -FilePath $gitInstaller -ArgumentList @(
        "/VERYSILENT",
        "/NORESTART",
        "/NOCANCEL",
        "/SP-",
        "/SUPPRESSMSGBOXES",
        "/CURRENTUSER"
      ) -PassThru
      if (-not $gitProcess.WaitForExit(300000)) {
        try { $gitProcess.Kill() } catch {}
        throw "Git 설치가 5분을 초과했습니다"
      }
      if ($gitProcess.ExitCode -ne 0) {
        throw "Git 설치 프로그램 종료 코드: $($gitProcess.ExitCode)"
      }
      $gitCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd\git.exe"),
        (Join-Path $env:ProgramFiles "Git\cmd\git.exe")
      )
      $gitExe = $gitCandidates |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1
    }
    if (-not $gitExe -or -not (Test-Path $gitExe)) {
      throw "git.exe를 찾을 수 없습니다"
    }
    $gitCmdDir = Split-Path -Parent $gitExe
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathEntries = @($userPath -split ";" | Where-Object { $_ })
    if ($pathEntries -notcontains $gitCmdDir) {
      [Environment]::SetEnvironmentVariable(
        "Path",
        (($pathEntries + $gitCmdDir) -join ";"),
        "User"
      )
    }
    $env:Path = "$gitCmdDir;$env:Path"
    $verifiedGit = (& $gitExe --version 2>&1 | Out-String).Trim()
    if ($verifiedGit -notmatch "^git version ") {
      throw "Git 버전 확인 실패: $verifiedGit"
    }
    Ok "Git ($verifiedGit)"
  } catch {
    Fail "Git $GIT_VERSION" $_
  }

  Step "Python $PYTHON_VERSION 설치..."
  try {
    $pythonInstaller = Join-Path $here "python-$PYTHON_VERSION-$architecture.exe"
    if (-not (Test-Path $pythonInstaller)) {
      throw "Python 설치 파일이 없습니다: $(Split-Path $pythonInstaller -Leaf)"
    }
    Assert-FileSha256 $pythonInstaller
    $pythonInstallDir = if ($architecture -eq "arm64") {
      Join-Path $env:LOCALAPPDATA "Programs\Python\Python314-arm64"
    } else {
      Join-Path $env:LOCALAPPDATA "Programs\Python\Python314"
    }
    $pythonExe = Join-Path $pythonInstallDir "python.exe"
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
    Assert-FileSha256 $uvArchive
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
  $adminPhaseFailed = $false
  $adminRequirements = @(Get-AdminPhaseRequirements | Select-Object -Unique)
  if ($adminRequirements.Count -eq 0) {
    Step "기존 보안 연결 구성이 정상입니다. 관리자 권한 요청을 생략합니다."
    Ok "보안 연결 구성"
  } else {
    Step "관리자 권한이 필요한 항목: $($adminRequirements -join ', ')"
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
  }
  try { Stop-Transcript | Out-Null } catch {}
  if ($userPhaseFailed -or $adminPhaseFailed) {
    exit 1
  }
  Step "SAMWOO-ORCA 실행 확인..."
  try {
    $installedApp = Join-Path $env:LOCALAPPDATA "Programs\SAMWOO-ORCA\SAMWOO-ORCA.exe"
    $appProcess = Start-Process -FilePath $installedApp -PassThru
    Start-Sleep -Seconds 8
    if ($appProcess.HasExited) {
      throw "앱이 실행 직후 종료됐습니다 (종료 코드: $($appProcess.ExitCode))"
    }
    Write-Host "    [OK] SAMWOO-ORCA가 정상 실행됐습니다." -ForegroundColor Green
  } catch {
    Write-Host "    [FAIL] SAMWOO-ORCA 실행 확인 -> $_" -ForegroundColor Red
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
    $architecture = Get-WindowsArchitecture
    $tailscaleMsiName = "tailscale-setup-$architecture.msi"
    $tailscaleMsi = Join-Path $here $tailscaleMsiName
    if ($architecture -eq "amd64" -and -not (Test-Path $tailscaleMsi)) {
      $tailscaleMsi = Join-Path $here "tailscale-setup.msi"
    }
    if (-not (Test-Path $tailscaleMsi)) {
      $tailscaleMsi = Join-Path $env:TEMP $tailscaleMsiName
      Invoke-WebRequest -UseBasicParsing `
        -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-$architecture.msi" `
        -OutFile $tailscaleMsi
    }
    Assert-TrustedPublisherSignature $tailscaleMsi "CN=Tailscale Inc."
    $tailscaleProcess = Start-Process msiexec.exe `
      -ArgumentList "/i", "`"$tailscaleMsi`"", "/qn" -PassThru
    if (-not $tailscaleProcess.WaitForExit(300000)) {
      try { $tailscaleProcess.Kill() } catch {}
      throw "Tailscale 설치가 5분을 초과했습니다"
    }
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

  $profileText = (& $tailscaleExe switch --list 2>$null | Out-String)
  $profileLines = @($profileText -split "\r?\n" | Where-Object { $_.Trim() })
  $expectedProfile = $profileLines |
    Where-Object { $_ -match [regex]::Escape($TS_TAILNET) } |
    Select-Object -First 1
  $activeProfile = $profileLines |
    Where-Object { $_.TrimEnd().EndsWith("*") } |
    Select-Object -First 1

  if ($expectedProfile) {
    if ($activeProfile -notmatch [regex]::Escape($TS_TAILNET)) {
      $switchProcess = Start-Process $tailscaleExe `
        -ArgumentList "switch", $TS_TAILNET -PassThru -Wait
      if ($switchProcess.ExitCode -ne 0) {
        throw "기존 samwooax 프로필 전환 실패: $($switchProcess.ExitCode)"
      }
    }
  } else {
    $authDir = Join-Path $env:ProgramData "SAMWOO-ORCA"
    $authFile = Join-Path $authDir "tailscale-authkey.tmp"
    New-Item -ItemType Directory -Force -Path $authDir | Out-Null
    try {
      Set-Content -LiteralPath $authFile -Value $TS_AUTHKEY -Encoding Ascii -NoNewline
      $loginProcess = Start-Process $tailscaleExe -ArgumentList @(
        "login",
        "--auth-key=file:$authFile",
        "--unattended",
        "--timeout=60s"
      ) -PassThru
      if (-not $loginProcess.WaitForExit(75000)) {
        try { $loginProcess.Kill() } catch {}
        throw "samwooax 로그인 시간이 75초를 초과했습니다"
      }
      if ($loginProcess.ExitCode -ne 0) {
        throw "samwooax 로그인 실패: $($loginProcess.ExitCode)"
      }
    } finally {
      Remove-Item $authFile -Force -ErrorAction SilentlyContinue
    }
  }

  $unattendedProcess = Start-Process $tailscaleExe `
    -ArgumentList "set", "--unattended=true", "--shields-up=true" -PassThru -Wait
  if ($unattendedProcess.ExitCode -ne 0) {
    throw "Tailscale 무인 실행 설정 실패: $($unattendedProcess.ExitCode)"
  }
  Start-Sleep -Seconds 3

  $verifiedProfiles = (& $tailscaleExe switch --list 2>$null | Out-String)
  $verifiedActiveProfile = @($verifiedProfiles -split "\r?\n") |
    Where-Object { $_.TrimEnd().EndsWith("*") } |
    Select-Object -First 1
  if ($verifiedActiveProfile -notmatch [regex]::Escape($TS_TAILNET)) {
    throw "활성 Tailscale 계정이 $TS_TAILNET 이 아닙니다"
  }
  $tailscaleIp = (& $tailscaleExe ip -4 2>$null | Select-Object -First 1)
  if (-not $tailscaleIp) {
    throw "테일넷 IP가 할당되지 않았습니다"
  }
  Ok "테일넷 합류 ($tailscaleIp)"
} catch {
  Fail "테일넷 합류" $_
}

Step "OpenSSH 클라이언트 설치..."
try {
  $sshExe = Join-Path $env:WINDIR "System32\OpenSSH\ssh.exe"
  if (-not (Test-Path $sshExe)) {
    $clientCapability = Get-WindowsCapability -Online -Name "OpenSSH.Client*" `
      -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $clientCapability) {
      throw "OpenSSH Client 기능을 찾을 수 없습니다"
    }
    if ($clientCapability.State -ne "Installed") {
      Add-WindowsCapability -Online -Name $clientCapability.Name -ErrorAction Stop | Out-Null
    }
  }
  if (-not (Test-Path $sshExe)) {
    throw "ssh.exe를 찾을 수 없습니다"
  }
  Ok "OpenSSH 클라이언트"
} catch {
  Fail "OpenSSH 클라이언트" $_
}

Step "노트북 인바운드 SSH 차단..."
try {
  $sshdService = Get-Service sshd -ErrorAction SilentlyContinue
  if ($sshdService) {
    if ($sshdService.Status -ne "Stopped") {
      Stop-Service sshd -Force -ErrorAction Stop
    }
    Set-Service sshd -StartupType Disabled -ErrorAction Stop
  }
  $sshFirewallRule = Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" `
    -ErrorAction SilentlyContinue
  if ($sshFirewallRule) {
    $sshFirewallRule | Set-NetFirewallRule -Enabled False | Out-Null
  }
  $adminKeys = Join-Path $env:ProgramData "ssh\administrators_authorized_keys"
  if (Test-Path $adminKeys) {
    $keptKeys = @(Get-Content $adminKeys | Where-Object {
      $_ -notmatch "hermes-agent-to-laptop|hermes-ai-center@tailnet"
    })
    Set-Content -Path $adminKeys -Value $keptKeys -Encoding ascii
  }
  Ok "인바운드 SSH 차단"
} catch {
  Fail "인바운드 SSH 차단" $_
}

$sshClientReady = Test-Path (Join-Path $env:WINDIR "System32\OpenSSH\ssh.exe")
$sshdStopped = (Get-Service sshd -ErrorAction SilentlyContinue).Status -ne "Running"
$sshFirewallDisabled = @(
  Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue |
    Where-Object { $_.Enabled -eq "True" }
).Count -eq 0
if ($sshClientReady -and $sshdStopped -and $sshFirewallDisabled) {
  Ok "로컬 연결 보안 확인"
} else {
  Fail "로컬 연결 보안 확인" "SSH 클라이언트 또는 인바운드 차단 상태를 확인하세요"
}

Show-Summary
$adminPhaseFailed = @($results.Values | Where-Object { $_ -ne "OK" }).Count -gt 0
try { Stop-Transcript | Out-Null } catch {}
if ($adminPhaseFailed) {
  exit 1
}
exit 0
