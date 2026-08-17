Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    docker compose down
    if ($LASTEXITCODE -ne 0) { throw 'docker compose down に失敗しました。' }
    Write-Host 'Paper Grammar Tutorを停止しました。model cache volumeは保持されています。' -ForegroundColor Green
} finally {
    Pop-Location
}
