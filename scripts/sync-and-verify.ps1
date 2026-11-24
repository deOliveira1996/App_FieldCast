param(
  [string]$SourceRepo = "C:\Users\deOliveira\.gemini\antigravity\worktrees\App_FieldCast\fieldcast_agent_swarm_setup",
  [string]$TargetRepo = "F:\Backup-data\local_data\App_FieldCast",
  [switch]$BuildAndroid
)

$ErrorActionPreference = "Stop"

$nodeDir = "E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs"
if (Test-Path $nodeDir) {
  $env:PATH = "$nodeDir;$env:PATH"
}

Write-Host "[1/6] Running security hook self-check in $SourceRepo..."
$hookPayload = '{"hookEventName":"PreToolUse","toolCall":{"name":"run_command","args":{"CommandLine":"npm test"}}}'
$hookOut = $hookPayload | node "$SourceRepo\.agents\scripts\safety-gate.mjs"
Write-Host "Hook probe output: $hookOut"

Write-Host "[2/6] Validating source worktree ($SourceRepo)..."
Push-Location $SourceRepo
try {
  npm run icons:generate
  npx tsc --noEmit
  npm run test
  npm run build
} finally {
  Pop-Location
}

if (Test-Path $TargetRepo) {
  Write-Host "[3/6] Syncing code/assets to $TargetRepo..."
  & robocopy $SourceRepo $TargetRepo /E /XD node_modules .git dist android\app\build android\.gradle /XF *.apk *.tsbuildinfo | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Robocopy failed with exit code $LASTEXITCODE"
  }

  Push-Location $TargetRepo
  try {
    Write-Host "[4/6] Generating icons & building Windows bundle in $TargetRepo..."
    npm run icons:generate
    npx tsc --noEmit
    npm run test
    npm run build

    Write-Host "[5/6] Syncing Capacitor Android..."
    npx cap sync android

    if ($BuildAndroid) {
      Write-Host "[6/6] Compiling Android Debug APK..."
      $env:JAVA_HOME = "E:\Microsoft Visual Studio18\Shared\Android\openjdk\jdk-21.0.8"
      $env:ANDROID_HOME = "E:\Android\Sdk"
      Push-Location "$TargetRepo\android"
      try {
        .\gradlew.bat assembleDebug --no-daemon
      } finally {
        Pop-Location
      }
    }
  } finally {
    Pop-Location
  }
}

Write-Host "[DONE] FieldCast verification and sync pipeline completed."
