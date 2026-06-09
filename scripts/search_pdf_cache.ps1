param(
    [Parameter(Mandatory = $true)]
    [string]$Query,
    [int]$Context = 2,
    [string]$CacheDir = "$env:USERPROFILE\.codex\cache\inventoryrfid-pdf"
)

if (-not (Test-Path -LiteralPath $CacheDir)) {
    throw "Cache nao encontrado: $CacheDir. Execute scripts\extract_pdf_text.ps1 primeiro."
}

$files = Get-ChildItem -LiteralPath $CacheDir -Filter *.txt -File -ErrorAction SilentlyContinue
if (-not $files) {
    throw "Nenhum texto extraido em $CacheDir."
}

$hits = foreach ($file in $files) {
    Select-String -LiteralPath $file.FullName -SimpleMatch -Pattern $Query -Context $Context |
        ForEach-Object {
            [pscustomobject]@{
                File = $file.FullName
                LineNumber = $_.LineNumber
                Line = $_.Line.Trim()
                Before = @($_.Context.PreContext)
                After = @($_.Context.PostContext)
            }
        }
}

@($hits) | ConvertTo-Json -Depth 5
