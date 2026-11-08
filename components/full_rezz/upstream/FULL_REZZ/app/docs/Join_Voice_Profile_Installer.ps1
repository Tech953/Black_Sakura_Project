param([string]$Directory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $Directory 'Installer_Delivery_Manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.installer.name -ne [IO.Path]::GetFileName($manifest.installer.name)) { throw 'Invalid installer filename' }
$output = Join-Path $Directory $manifest.installer.name
if (Test-Path -LiteralPath $output) {
    if ((Get-Item -LiteralPath $output).Length -eq $manifest.installer.bytes -and (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.installer.sha256) {
        Write-Host "Verified installer already present: $output"
        return
    }
    throw 'A different output file already exists. Move it before joining.'
}
foreach ($part in $manifest.parts) {
    if ($part.name -ne [IO.Path]::GetFileName($part.name)) { throw 'Invalid part filename' }
    $path = Join-Path $Directory $part.name
    if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing delivery part: $($part.name)" }
    if ((Get-Item -LiteralPath $path).Length -ne $part.bytes) { throw "Incomplete delivery part: $($part.name)" }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $part.sha256) { throw "Hash mismatch: $($part.name)" }
}
$temporary = $output + '.joining-' + [Guid]::NewGuid().ToString('N')
$destination = $null
try {
    $destination = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    foreach ($part in $manifest.parts) {
        $source = [IO.File]::OpenRead((Join-Path $Directory $part.name))
        try { $source.CopyTo($destination, 4194304) } finally { $source.Dispose() }
    }
    $destination.Flush($true)
    $destination.Dispose()
    $destination = $null
    if ((Get-Item -LiteralPath $temporary).Length -ne $manifest.installer.bytes -or (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.installer.sha256) { throw 'Reconstructed installer verification failed' }
    [IO.File]::Move($temporary, $output)
    Write-Host "Verified single installer: $output"
    Write-Host 'Run this EXE to install. No Node or external Python is required.'
} finally {
    if ($null -ne $destination) { $destination.Dispose() }
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}
