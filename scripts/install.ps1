# Installs Tourwright's runtime pieces on Windows, without admin rights and without Docker:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   $env:VOICES = "en_US-amy-medium"; .\scripts\install.ps1
#   $env:WITH_EDGE_TTS = "false"; .\scripts\install.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { throw "Tourwright needs Node.js 20 or newer (https://nodejs.org)" }

Push-Location $Root
try {
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  $tourwrightArgs = @("install")
  if ($env:VOICES) { $tourwrightArgs += @("--voices", ($env:VOICES -replace " ", ",")) }
  if ($env:WITH_EDGE_TTS -eq "false") { $tourwrightArgs += "--no-edge" }
  node bin\tourwright.js @tourwrightArgs
  if ($LASTEXITCODE -ne 0) { throw "tourwright install failed" }
} finally {
  Pop-Location
}
