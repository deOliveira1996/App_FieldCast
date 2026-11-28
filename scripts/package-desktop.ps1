<#
.SYNOPSIS
  Prepares and optionally packages the FieldCast Windows desktop wrapper (.exe portable & NSIS)
  for either the Full (`dist/`) or Minimal (`dist-minimal/`) edition.
.DESCRIPTION
  1. Builds the selected edition with relative base path (`VITE_BASE_PATH="./"`):
     - `-Edition full` (default): runs `npm run build:full` -> `dist/`
     - `-Edition minimal`: runs `npm run build:minimal` -> `dist-minimal/`
  2. Syncs the edition output cleanly into `desktop/electron/dist/`.
  3. When `-BuildInstaller` is passed, installs Electron dependencies and builds Windows `.exe` packages via electron-builder.
#>
[CmdletBinding()]
param(
  [ValidateSet('full', 'minimal')]
  [string]$Edition = 'full',
  [switch]$BuildInstaller,
  [switch]$SkipWebBuild
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $vsNode = 'E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs'
  if (Test-Path $vsNode) {
    $env:PATH = "$vsNode;$env:PATH"
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDirName = if ($Edition -eq 'minimal') { 'dist-minimal' } else { 'dist' }
$buildScript = if ($Edition -eq 'minimal') { 'build:minimal' } else { 'build:full' }
$distDir = Join-Path $repoRoot $distDirName
$electronDir = Join-Path $repoRoot 'desktop\electron'
$electronDistDir = Join-Path $electronDir 'dist'

Write-Host "=== FieldCast V4.3 ($Edition) — Desktop Wrapper Preparation ===" -ForegroundColor Cyan
Write-Host "Workspace: $repoRoot"
Write-Host "Source bundle: $distDirName"

Push-Location $repoRoot
try {
  if (-not $SkipWebBuild) {
    Write-Host "[1/3] Building static bundle ($buildScript) with relative base (./)..." -ForegroundColor Yellow
    $env:VITE_BASE_PATH = './'
    npm run $buildScript
    if ($LASTEXITCODE -ne 0) {
      throw "Web build ($buildScript) failed with exit code $LASTEXITCODE"
    }
  } else {
    Write-Host '[1/3] Skipping web build (-SkipWebBuild).' -ForegroundColor DarkGray
  }

  if (-not (Test-Path (Join-Path $distDir 'index.html'))) {
    throw "Missing $distDirName/index.html at $distDir. Run without -SkipWebBuild."
  }

  Write-Host "[2/3] Syncing $distDirName/ -> desktop/electron/dist/..." -ForegroundColor Yellow
  if (Test-Path $electronDistDir) {
    Remove-Item -Path $electronDistDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $electronDistDir -Force | Out-Null
  Copy-Item -Path (Join-Path $distDir '*') -Destination $electronDistDir -Recurse -Force

  if ($BuildInstaller) {
    Write-Host "[3/3] Packaging FieldCast ($Edition) Windows Portable & NSIS (.exe) via electron-builder..." -ForegroundColor Yellow
    Push-Location $electronDir
    try {
      npm install
      if ($LASTEXITCODE -ne 0) {
        throw "Electron npm install failed with exit code $LASTEXITCODE"
      }
      npm run pack:win
      if ($LASTEXITCODE -ne 0) {
        throw "electron-builder pack:win failed with exit code $LASTEXITCODE"
      }
      Write-Host "Artifacts ready in: $(Join-Path $electronDir 'release')" -ForegroundColor Green
    } finally {
      Pop-Location
    }
  } else {
    Write-Host "[3/3] Desktop wrapper prepared for '$Edition' edition ($distDirName synced)." -ForegroundColor Green
    Write-Host 'Next steps:' -ForegroundColor Cyan
    Write-Host "  cd `"$electronDir`""
    Write-Host '  npm install'
    Write-Host '  npm start        # Run offline desktop window'
    Write-Host '  npm run pack:win # Build Windows portable + NSIS .exe'
    Write-Host "  (or rerun: .\scripts\package-desktop.ps1 -Edition $Edition -BuildInstaller)"
  }
} finally {
  Pop-Location
}
