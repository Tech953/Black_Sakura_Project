$ErrorActionPreference = 'Stop'
$TaskRoot = $PSScriptRoot
$ManifestPath = Join-Path $TaskRoot 'FULL_REZZ_3.0_Delivery_Manifest.json'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$OutputPath = Join-Path $TaskRoot $Manifest.installer.name
$StagePath = $OutputPath + '.assembling'
if (Test-Path -LiteralPath $OutputPath) {
    $ExistingHash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ExistingHash -eq $Manifest.installer.sha256) { Write-Host 'The complete verified installer is already present.'; exit 0 }
    throw 'An installer with different bytes already exists. Move it aside before assembly.'
}
try {
    $Output = [System.IO.File]::Open($StagePath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        foreach ($Part in $Manifest.parts) {
            if ($Part.name -notmatch '^FULL_REZZ_3\.0_Setup\.part[0-9]{2}$') { throw 'Unexpected part filename in manifest.' }
            $InputPath = Join-Path $TaskRoot $Part.name
            if (-not (Test-Path -LiteralPath $InputPath)) { throw ('Missing part: ' + $Part.name) }
            if ((Get-Item -LiteralPath $InputPath).Length -ne $Part.bytes) { throw ('Wrong size: ' + $Part.name) }
            if ((Get-FileHash -LiteralPath $InputPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Part.sha256) { throw ('Checksum failed: ' + $Part.name) }
            Write-Host ('Verified ' + $Part.name)
            $Input = [System.IO.File]::OpenRead($InputPath)
            try { $Input.CopyTo($Output, 1048576) } finally { $Input.Dispose() }
        }
    } finally { $Output.Dispose() }
    if ((Get-Item -LiteralPath $StagePath).Length -ne $Manifest.installer.bytes) { throw 'Assembled installer size is wrong.' }
    if ((Get-FileHash -LiteralPath $StagePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Manifest.installer.sha256) { throw 'Assembled installer checksum failed.' }
    Move-Item -LiteralPath $StagePath -Destination $OutputPath
    Write-Host ('Ready: ' + $OutputPath)
    Write-Host 'Run that one Setup.exe. No Node, separate Python or model server is needed.'
} catch {
    if (Test-Path -LiteralPath $StagePath) { Remove-Item -LiteralPath $StagePath }
    throw
}
