<#
.SYNOPSIS
  Prepares and optionally packages the FieldCast Windows desktop wrapper (.exe portable & NSIS).
.DESCRIPTION
  1. Builds the relative-path production bundle (`VITE_BASE_PATH="./" npm run build`).
  2. Syncs `dist/` cleanly into `desktop/electron/dist/`.
  3. When `-BuildInstaller` is passed, installs Electron dependencies and builds Windows `.exe` packages via electron-builder.
#>
[CmdletBinding()]
param(
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
$distDir = Join-Path $repoRoot 'dist'
$electronDir = Join-Path $repoRoot 'desktop\electron'
$electronDistDir = Join-Path $electronDir 'dist'

Write-Host '=== FieldCast V4.3 — Desktop Wrapper Preparation ===' -ForegroundColor Cyan
Write-Host "Workspace: $repoRoot"

Push-Location $repoRoot
try {
  if (-not $SkipWebBuild) {
    Write-Host '[1/3] Building static bundle with relative base (./)...' -ForegroundColor Yellow
    $env:VITE_BASE_PATH = './'
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Web build failed with exit code $LASTEXITCODE"
    }
  } else {
    Write-Host '[1/3] Skipping web build (-SkipWebBuild).' -ForegroundColor DarkGray
  }

  if (-not (Test-Path (Join-Path $distDir 'index.html'))) {
    throw "Missing dist/index.html at $distDir. Run without -SkipWebBuild."
  }

  Write-Host '[2/3] Syncing dist/ -> desktop/electron/dist/...' -ForegroundColor Yellow
  if (Test-Path $electronDistDir) {
    Remove-Item -Path $electronDistDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $electronDistDir -Force | Out-Null
  Copy-Item -Path (Join-Path $distDir '*') -Destination $electronDistDir -Recurse -Force

  if ($BuildInstaller) {
    Write-Host '[3/3] Packaging Windows Portable & NSIS (.exe) via electron-builder...' -ForegroundColor Yellow
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
    Write-Host '[3/3] Desktop wrapper prepared (dist synced).' -ForegroundColor Green
    Write-Host 'Next steps:' -ForegroundColor Cyan
    Write-Host "  cd `"$electronDir`""
    Write-Host '  npm install'
    Write-Host '  npm start        # Run offline desktop window'
    Write-Host '  npm run pack:win # Build Windows portable + NSIS .exe'
    Write-Host '  (or rerun: .\scripts\package-desktop.ps1 -BuildInstaller)'
  }
} finally {
  Pop-Location
}
