param(
    [Parameter(Mandatory = $true)]
    [string]$PdfPath,
    [switch]$Force,
    [string]$CacheDir = "$env:USERPROFILE\.codex\cache\inventoryrfid-pdf"
)

$resolvedPdf = (Resolve-Path -LiteralPath $PdfPath).Path
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

function Find-Tool([string]$Name) {
    $wingetRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $wingetMatch = Get-ChildItem -LiteralPath $wingetRoot -Recurse -Filter $Name -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Poppler' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($wingetMatch) { return $wingetMatch.FullName }

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    throw "Ferramenta '$Name' nao encontrada. Instale Poppler ou adicione ao PATH."
}

$pdftotext = Find-Tool "pdftotext.exe"
$pdfinfo = $null
try { $pdfinfo = Find-Tool "pdfinfo.exe" } catch { }

$hash = (Get-FileHash -LiteralPath $resolvedPdf -Algorithm SHA256).Hash.ToLowerInvariant()
$safeName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedPdf) -replace '[^A-Za-z0-9._-]+', '_'
$txtPath = Join-Path $CacheDir "$safeName-$($hash.Substring(0, 12)).txt"
$metaPath = Join-Path $CacheDir "$safeName-$($hash.Substring(0, 12)).json"

if ($Force -or -not (Test-Path -LiteralPath $txtPath)) {
    & $pdftotext -layout $resolvedPdf $txtPath
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao extrair texto de '$resolvedPdf'."
    }
}

$infoText = $null
if ($pdfinfo) {
    $infoText = (& $pdfinfo $resolvedPdf) -join "`n"
}

$meta = [ordered]@{
    PdfPath = $resolvedPdf
    TextPath = $txtPath
    Hash = $hash
    ExtractedAt = (Get-Date).ToString("s")
    PdfInfo = $infoText
}

$meta | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metaPath -Encoding UTF8
$meta | ConvertTo-Json -Depth 4
