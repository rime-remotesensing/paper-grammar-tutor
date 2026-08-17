Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

function Get-ConfiguredValue {
    param([string]$Name, [string]$Default)
    $processValue = [Environment]::GetEnvironmentVariable($Name)
    if ($processValue) { return $processValue }
    $envPath = Join-Path $repoRoot '.env'
    if (Test-Path -LiteralPath $envPath) {
        $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -Last 1
        if ($line) {
            $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
            if ($value) { return $value }
        }
    }
    return $Default
}

try {
    $paddlePort = Get-ConfiguredValue 'PGT_PADDLE_PORT' '8008'
    $pymupdfPort = Get-ConfiguredValue 'PGT_PYMUPDF_PORT' '8009'
    $ollamaPort = Get-ConfiguredValue 'PGT_OLLAMA_PORT' '11434'
    docker compose ps
    Write-Host "`nPyMuPDF health:"
    try { Invoke-RestMethod "http://127.0.0.1:$pymupdfPort/health" -TimeoutSec 5 | ConvertTo-Json -Compress } catch { Write-Host "  unavailable: $($_.Exception.Message)" }
    Write-Host 'Paddle health:'
    try { Invoke-RestMethod "http://127.0.0.1:$paddlePort/health" -TimeoutSec 5 | ConvertTo-Json -Compress } catch { Write-Host "  unavailable: $($_.Exception.Message)" }
    Write-Host 'Ollama version/models:'
    try {
        Invoke-RestMethod "http://127.0.0.1:$ollamaPort/api/version" -TimeoutSec 5 | ConvertTo-Json -Compress
        docker compose exec -T ollama ollama list
    } catch { Write-Host "  unavailable: $($_.Exception.Message)" }
} finally {
    Pop-Location
}
