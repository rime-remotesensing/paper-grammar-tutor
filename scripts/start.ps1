[CmdletBinding()]
param(
    [switch]$NoBrowser
)

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

function Wait-ComposeHealth {
    param([string]$Service, [int]$TimeoutSeconds)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $containerId = (docker compose ps -q $Service).Trim()
        if ($containerId) {
            $status = (docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $containerId).Trim()
            if ($status -eq 'healthy' -or $status -eq 'running') {
                Write-Host "  $Service : $status" -ForegroundColor Green
                return
            }
            if ($status -eq 'unhealthy' -or $status -eq 'exited' -or $status -eq 'dead') {
                docker compose logs --tail 80 $Service
                throw "$Service の起動に失敗しました (status: $status)。"
            }
        }
        Start-Sleep -Seconds 3
    }
    docker compose logs --tail 80 $Service
    throw "$Service のhealth待機がタイムアウトしました。"
}

try {
    Write-Host 'Paper Grammar Tutor (Docker) を起動します。' -ForegroundColor Cyan

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'docker コマンドが見つかりません。Docker Desktopをインストールしてください。'
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Docker daemonに接続できません。Docker Desktopを起動してください。' }
    docker compose version *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Composeを利用できません。' }

    $ports = [ordered]@{
        web = [int](Get-ConfiguredValue 'PGT_WEB_PORT' '5173')
        paddle = [int](Get-ConfiguredValue 'PGT_PADDLE_PORT' '8008')
        pymupdf = [int](Get-ConfiguredValue 'PGT_PYMUPDF_PORT' '8009')
        stanza = [int](Get-ConfiguredValue 'PGT_STANZA_PORT' '8010')
        ollama = [int](Get-ConfiguredValue 'PGT_OLLAMA_PORT' '11434')
    }
    foreach ($entry in $ports.GetEnumerator()) {
        $listeners = Get-NetTCPConnection -State Listen -LocalPort $entry.Value -ErrorAction SilentlyContinue
        if ($listeners) {
            $pids = ($listeners.OwningProcess | Sort-Object -Unique) -join ', '
            throw "port $($entry.Value) ($($entry.Key)) は使用中です。PID: $pids。自動停止はしません。"
        }
    }

    Write-Host 'Docker imageをbuildし、serviceを起動します。初回は時間がかかります。'
    docker compose up --build -d
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up に失敗しました。' }

    Write-Host 'service healthを待機しています。'
    Wait-ComposeHealth 'web' 180
    Wait-ComposeHealth 'pymupdf-layout' 180
    Wait-ComposeHealth 'stanza-syntax' 180
    Wait-ComposeHealth 'ollama' 180
    Wait-ComposeHealth 'paddle-ocr' 1800

    $paddleHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$($ports.paddle)/health" -TimeoutSec 10
    if ($paddleHealth.status -ne 'ok' -or $paddleHealth.gpuAvailable -ne $true -or $paddleHealth.modelLoaded -ne $true -or $paddleHealth.device -ne 'gpu') {
        throw "Paddle GPU healthが不正です: $($paddleHealth | ConvertTo-Json -Compress)"
    }

    $model = Get-ConfiguredValue 'PGT_OLLAMA_MODEL' 'qwen2.5:7b-instruct'
    $models = docker compose exec -T ollama ollama list
    if ($LASTEXITCODE -ne 0) { throw 'Ollama model一覧を取得できません。' }
    if (-not ($models -match "(?m)^$([regex]::Escape($model))\s")) {
        Write-Host "Ollama model $model を初回downloadします。"
        docker compose exec -T ollama ollama pull $model
        if ($LASTEXITCODE -ne 0) { throw "Ollama model $model のdownloadに失敗しました。" }
    } else {
        Write-Host "Ollama model $model はcache済みです。" -ForegroundColor Green
    }

    & (Join-Path $PSScriptRoot 'status.ps1')
    $url = "http://localhost:$($ports.web)"
    Write-Host "起動完了: $url" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process $url }
} catch {
    Write-Error $_
    exit 1
} finally {
    Pop-Location
}
