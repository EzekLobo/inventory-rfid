param(
    [int]$DebounceSeconds = 2,
    [switch]$CleanAux
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tccDir = Join-Path $projectRoot "docs\tcc"
$checkScript = Join-Path $PSScriptRoot "check_tcc_all.ps1"

if (-not (Test-Path -LiteralPath $tccDir)) {
    throw "Diretorio do TCC nao encontrado: $tccDir"
}

if (-not (Test-Path -LiteralPath $checkScript)) {
    throw "Script de verificacao nao encontrado: $checkScript"
}

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $tccDir
$watcher.IncludeSubdirectories = $true
$watcher.Filter = "*.*"
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
$watcher.EnableRaisingEvents = $true

$lastRun = Get-Date "2000-01-01"
$relevantExtensions = @(".tex", ".bib", ".png", ".jpg", ".jpeg", ".pdf")

function Invoke-TccCheck {
    $args = @()
    if ($CleanAux) { $args += "-CleanAux" }

    Write-Host ""
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Alteracao detectada. Recompilando TCC..." -ForegroundColor Cyan
    & $checkScript @args
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Verificacao concluida." -ForegroundColor Green
    } else {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Verificacao encontrou problemas." -ForegroundColor Red
    }
}

Write-Host "Observando alteracoes em $tccDir" -ForegroundColor Cyan
Write-Host "Pressione Ctrl+C para parar."

try {
    while ($true) {
        $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 500)
        if ($change.TimedOut) { continue }

        $extension = [System.IO.Path]::GetExtension($change.Name).ToLowerInvariant()
        if ($extension -notin $relevantExtensions) { continue }

        if (((Get-Date) - $lastRun).TotalSeconds -lt $DebounceSeconds) {
            Start-Sleep -Seconds $DebounceSeconds
        }

        $lastRun = Get-Date
        Invoke-TccCheck
    }
}
finally {
    $watcher.Dispose()
}
