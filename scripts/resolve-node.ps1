$ErrorActionPreference = 'Stop'
$directories = [System.Collections.Generic.List[string]]::new()
$pathSources = @(
    $env:Path,
    [System.Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [System.Environment]::GetEnvironmentVariable('Path', 'User')
)
foreach ($pathSource in $pathSources) {
    foreach ($entry in ($pathSource -split ';')) {
        $directory = $entry.Trim().Trim('"')
        if ($directory -and -not $directories.Contains($directory)) { $directories.Add($directory) }
    }
}
foreach ($directory in @(
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs' }),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs' }),
    $env:NVM_SYMLINK
)) {
    if ($directory -and -not $directories.Contains($directory)) { $directories.Add($directory) }
}
foreach ($directory in $directories) {
    $nodePath = Join-Path $directory 'node.exe'
    $npmPath = Join-Path $directory 'npm.cmd'
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf) -or -not (Test-Path -LiteralPath $npmPath -PathType Leaf)) { continue }
    $versionText = (& $nodePath --version).Trim()
    if ($LASTEXITCODE -ne 0) { continue }
    try { $version = [version]::Parse($versionText.TrimStart([char]'v')) } catch { continue }
    if ($version -ge [version]'22.12') {
        Write-Output $directory
        exit 0
    }
}
exit 1