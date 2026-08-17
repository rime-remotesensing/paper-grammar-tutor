[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:5173'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $assetDir = Join-Path $repoRoot 'dist\assets'
    $workers = @(Get-ChildItem -LiteralPath $assetDir -Filter 'pdf.worker.min-*.mjs' -File)
    if ($workers.Count -ne 1) {
        throw "Expected exactly one generated PDF worker, found $($workers.Count)."
    }
    $worker = $workers[0]

    $referenced = Get-ChildItem -LiteralPath $assetDir -Filter '*.js' -File |
        Select-String -SimpleMatch $worker.Name -Quiet
    if (-not $referenced) {
        throw "Generated JavaScript bundles do not reference $($worker.Name)."
    }

    $containerId = (docker compose ps -q web).Trim()
    if (-not $containerId) { throw 'The web container is not running.' }
    docker compose exec -T web test -f "/usr/share/nginx/html/assets/$($worker.Name)"
    if ($LASTEXITCODE -ne 0) { throw "The web container does not contain $($worker.Name)." }

    $workerUrl = "$($BaseUrl.TrimEnd('/'))/assets/$($worker.Name)"
    $probe = (& curl.exe -sS -o NUL -w '%{http_code}|%{content_type}|%{size_download}' $workerUrl).Trim()
    $parts = $probe -split '\|'
    if ($parts.Count -ne 3 -or $parts[0] -ne '200') { throw "Worker HTTP probe failed: $probe" }
    if ($parts[1] -notmatch '^(application|text)/(javascript|ecmascript)') {
        throw "Worker MIME is not JavaScript-compatible: $($parts[1])"
    }
    if ([int64]$parts[2] -ne $worker.Length) {
        throw "Worker response size $($parts[2]) differs from dist size $($worker.Length)."
    }

    $missingUrl = "$($BaseUrl.TrimEnd('/'))/assets/definitely-does-not-exist.mjs"
    $missingStatus = (& curl.exe -sS -o NUL -w '%{http_code}' $missingUrl).Trim()
    if ($missingStatus -ne '404') { throw "Missing asset returned HTTP $missingStatus instead of 404." }

    Write-Host "Web asset validation passed: $($worker.Name), $($worker.Length) bytes, $($parts[1]), missing asset 404."
} finally {
    Pop-Location
}
