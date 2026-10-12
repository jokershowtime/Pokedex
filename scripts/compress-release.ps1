$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

try {
    $projectDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $releaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectDirectory 'release'))
    $applicationDirectory = [System.IO.Path]::GetFullPath((Join-Path $releaseDirectory 'Pokedex-win32-x64'))
    $metadata = Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    $version = [string]$metadata.version
    if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
        throw 'package.json contains an invalid version number.'
    }

    $archivePath = [System.IO.Path]::GetFullPath((Join-Path $releaseDirectory "Pokedex-$version-win64.zip"))
    $temporaryArchive = [System.IO.Path]::GetFullPath((Join-Path $releaseDirectory "Pokedex-$version-win64.packing.zip"))
    $releasePrefix = $releaseDirectory.TrimEnd('\') + '\'
    foreach ($target in @($applicationDirectory, $archivePath, $temporaryArchive)) {
        if (-not $target.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'The output path is outside the project release directory.'
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $applicationDirectory 'Pokedex.exe') -PathType Leaf)) {
        throw 'Pokedex.exe was not generated. Run the package step first.'
    }

    Compress-Archive -LiteralPath $applicationDirectory -DestinationPath $temporaryArchive -CompressionLevel Optimal -Force
    Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
    Write-Host "[OK] ZIP: $archivePath"
    exit 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
