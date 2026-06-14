param(
    [switch]$CleanAux,
    [switch]$OpenPdf,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$compileScript = Join-Path $PSScriptRoot "compile_tcc_pdf.ps1"
$tccDir = Join-Path $projectRoot "docs\tcc"
$logPath = Join-Path $tccDir "PRINCIPAL.log"

if (-not (Test-Path -LiteralPath $compileScript)) {
    throw "Script de compilacao nao encontrado: $compileScript"
}

$compileArgs = @()
if ($CleanAux) { $compileArgs += "-CleanAux" }

$startedAt = Get-Date
$rawCompile = & $compileScript @compileArgs
$compile = $rawCompile | ConvertFrom-Json

$checks = [ordered]@{
    PdfExists = [bool]$compile.Exists
    HasLogWarnings = @($compile.LogWarnings).Count -gt 0
    UndefinedReferences = @()
    UndefinedCitations = @()
    OverfullBoxes = @()
    FatalErrors = @()
}

if (Test-Path -LiteralPath $logPath) {
    $checks.UndefinedReferences = @(
        Select-String -LiteralPath $logPath -Pattern "Reference .* undefined|Undefined references" |
            ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
    )
    $checks.UndefinedCitations = @(
        Select-String -LiteralPath $logPath -Pattern "Citation .* undefined|There were undefined citations" |
            ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
    )
    $checks.OverfullBoxes = @(
        Select-String -LiteralPath $logPath -Pattern "Overfull \\[hv]box" |
            ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
    )
    $checks.FatalErrors = @(
        Select-String -LiteralPath $logPath -Pattern "Fatal error|Emergency stop|No output PDF file produced" |
            ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
    )
}

$blockingIssues = @()
if (-not $checks.PdfExists) { $blockingIssues += "PDF nao foi gerado." }
if (@($checks.UndefinedReferences).Count -gt 0) { $blockingIssues += "Referencias indefinidas." }
if (@($checks.UndefinedCitations).Count -gt 0) { $blockingIssues += "Citacoes indefinidas." }
if (@($checks.FatalErrors).Count -gt 0) { $blockingIssues += "Erros fatais no log." }

$result = [pscustomobject]@{
    Ok = @($blockingIssues).Count -eq 0
    StartedAt = $startedAt.ToString("s")
    FinishedAt = (Get-Date).ToString("s")
    PdfPath = $compile.PdfPath
    PdfLength = $compile.Length
    BuildLog = $compile.BuildLog
    LatexLog = $logPath
    BlockingIssues = @($blockingIssues)
    Checks = $checks
}

if ($OpenPdf -and $result.Ok -and (Test-Path -LiteralPath $result.PdfPath)) {
    Start-Process -FilePath $result.PdfPath | Out-Null
}

if ($Json) {
    $result | ConvertTo-Json -Depth 6
    exit $(if ($result.Ok) { 0 } else { 1 })
}

Write-Host "TCC PDF check" -ForegroundColor Cyan
Write-Host "PDF: $($result.PdfPath)"
Write-Host "Tamanho: $($result.PdfLength) bytes"
Write-Host "Log de build: $($result.BuildLog)"

if ($result.Ok) {
    Write-Host "Status: OK" -ForegroundColor Green
} else {
    Write-Host "Status: problemas encontrados" -ForegroundColor Red
    $result.BlockingIssues | ForEach-Object { Write-Host "- $_" -ForegroundColor Red }
}

if (@($checks.OverfullBoxes).Count -gt 0) {
    Write-Host "Aviso: ha caixas overfull no log ($(@($checks.OverfullBoxes).Count))." -ForegroundColor Yellow
}

if (@($compile.LogWarnings).Count -gt 0) {
    Write-Host "Avisos do compilador:" -ForegroundColor Yellow
    @($compile.LogWarnings) | Select-Object -First 12 | ForEach-Object {
        Write-Host "- $_" -ForegroundColor Yellow
    }
}

exit $(if ($result.Ok) { 0 } else { 1 })
