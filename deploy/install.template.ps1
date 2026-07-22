# SAMWOO-ORCA one-click setup: app install + Tailscale join.
# Put this next to samwoo-orca-windows-setup.exe (and optionally
# tailscale-setup.msi) on the shared drive. Fill in TS_AUTHKEY before deploying.

$TS_AUTHKEY = "tskey-auth-REPLACE_ME"

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# --- self-elevate (Tailscale MSI needs admin) ---------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Step "Requesting administrator rights..."
  Start-Process powershell -Verb RunAs -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$($MyInvocation.MyCommand.Path)`""
  ) -Wait
  exit
}

# --- 1. SAMWOO-ORCA -----------------------------------------------------------
$setup = Join-Path $here "samwoo-orca-windows-setup.exe"
if (-not (Test-Path $setup)) {
  Write-Host "ERROR: samwoo-orca-windows-setup.exe not found next to this script." -ForegroundColor Red
  exit 1
}
Step "Installing SAMWOO-ORCA (silent)..."
Start-Process -FilePath $setup -ArgumentList "/S" -Wait
Step "SAMWOO-ORCA installed."

# --- 2. Tailscale -------------------------------------------------------------
$tailscaleExe = "$env:ProgramFiles\Tailscale\tailscale.exe"
if (-not (Test-Path $tailscaleExe)) {
  $msi = Join-Path $here "tailscale-setup.msi"
  if (-not (Test-Path $msi)) {
    Step "Downloading Tailscale..."
    $msi = Join-Path $env:TEMP "tailscale-setup.msi"
    Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi" -OutFile $msi
  }
  Step "Installing Tailscale (silent)..."
  Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/qn" -Wait
} else {
  Step "Tailscale already installed."
}

# --- 3. Join the tailnet ------------------------------------------------------
if ($TS_AUTHKEY -like "*REPLACE_ME*") {
  Write-Host "WARNING: TS_AUTHKEY is not set. Skipping tailnet join." -ForegroundColor Yellow
  Write-Host "         Edit install.ps1 and set the pre-auth key, then run again." -ForegroundColor Yellow
} else {
  Step "Joining Tailscale network..."
  & $tailscaleExe up --authkey=$TS_AUTHKEY --unattended
  Step "Tailnet joined."
}

# --- 4. Verify agent server reachability -------------------------------------
Step "Checking connection to the Hermes server..."
$ping = & $tailscaleExe ping -c 1 hermes-new-container 2>&1
Write-Host $ping
Write-Host ""
Write-Host "Done. Launch SAMWOO-ORCA from the desktop shortcut." -ForegroundColor Green
Write-Host "On first project open you will be asked to pick a team agent." -ForegroundColor Green
