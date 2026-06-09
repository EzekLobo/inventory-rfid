param(
    [switch]$CleanAux
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$tccDir = Join-Path $projectRoot "docs\tcc"
$main = "PRINCIPAL.tex"

if (-not (Test-Path -LiteralPath (Join-Path $tccDir $main))) {
    throw "Arquivo principal nao encontrado em $tccDir."
}

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Comando '$Name' nao encontrado no PATH." }
    return $cmd.Source
}

Require-Command "pdflatex.exe" | Out-Null
Require-Command "bibtex.exe" | Out-Null

Push-Location $tccDir
try {
    $buildLog = Join-Path $env:TEMP "inventoryrfid_tcc_build.log"
    if (Test-Path -LiteralPath $buildLog) {
        Remove-Item -LiteralPath $buildLog -Force
    }

    if ($CleanAux) {
        foreach ($pattern in @("*.fls", "*.fdb_latexmk", "*.synctex.gz")) {
            Get-ChildItem -LiteralPath $tccDir -File -Filter $pattern -ErrorAction SilentlyContinue |
                Remove-Item -Force
        }
    }

    $steps = @(
        @{ Cmd = "pdflatex"; Args = @("-interaction=nonstopmode", "-halt-on-error", $main) },
        @{ Cmd = "bibtex"; Args = @("PRINCIPAL") },
        @{ Cmd = "pdflatex"; Args = @("-interaction=nonstopmode", "-halt-on-error", $main) },
        @{ Cmd = "pdflatex"; Args = @("-interaction=nonstopmode", "-halt-on-error", $main) }
    )

    foreach ($step in $steps) {
        "## $($step.Cmd) $($step.Args -join ' ')" | Add-Content -LiteralPath $buildLog -Encoding UTF8
        $output = & $step.Cmd @($step.Args) 2>&1
        $output | Add-Content -LiteralPath $buildLog -Encoding UTF8
        if ($LASTEXITCODE -ne 0) {
            $tail = $output | Select-Object -Last 40
            throw "Falha ao executar $($step.Cmd). Ultimas linhas:`n$($tail -join "`n")"
        }
    }

    $logPath = Join-Path $tccDir "PRINCIPAL.log"
    $warnings = @()
    if (Test-Path -LiteralPath $logPath) {
        $warnings = Select-String -LiteralPath $logPath -Pattern "LaTeX Warning: Reference|Citation.*undefined|Undefined references|Overfull \\hbox|Overfull \\vbox|Fatal error|Emergency stop" |
            ForEach-Object { "$($_.LineNumber):$($_.Line.Trim())" }
    }

    $pdfPath = Join-Path $tccDir "PRINCIPAL.pdf"
    [pscustomobject]@{
        PdfPath = $pdfPath
        Exists = Test-Path -LiteralPath $pdfPath
        Length = if (Test-Path -LiteralPath $pdfPath) { (Get-Item -LiteralPath $pdfPath).Length } else { 0 }
        BuildLog = $buildLog
        LogWarnings = @($warnings)
    } | ConvertTo-Json -Depth 4
}
finally {
    Pop-Location
}
