$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$currentVersion = $null
$versionUpdateStarted = $false
$releaseTagCreated = $false
$releaseTagPushed = $false
$exitCode = 1

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Description
    )

    & $FilePath @Arguments
    $commandExitCode = $LASTEXITCODE
    if ($commandExitCode -ne 0) {
        throw "$Description failed with exit code $commandExitCode."
    }
}

function Read-YesNo {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [bool]$Default = $false
    )

    $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
    while ($true) {
        $answer = (Read-Host "$Prompt $hint").Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
        if ($answer -in @('y', 'yes')) { return $true }
        if ($answer -in @('n', 'no')) { return $false }
        Write-Host '请输入 y 或 n。' -ForegroundColor Yellow
    }
}

Push-Location -LiteralPath $projectRoot
try {
    $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    $ghCommand = Get-Command gh.exe -ErrorAction SilentlyContinue
    if (-not $gitCommand) { throw '找不到 Git。请先安装 Git for Windows。' }
    if (-not $nodeCommand -or -not $npmCommand) { throw '找不到 Node.js 或 npm。需要 Node.js 22.12 或更新版本。' }
    if (-not $ghCommand) { throw '找不到 GitHub CLI。请安装 https://cli.github.com/ 并完成 gh auth login。' }

    $nodeVersionText = (& $nodeCommand.Source --version).Trim()
    if ($LASTEXITCODE -ne 0) { throw '无法读取 Node.js 版本。' }
    $nodeVersion = [version]::Parse($nodeVersionText.Trim().TrimStart([char]'v'))
    if ($nodeVersion -lt [version]'22.12') { throw "当前 Node.js 为 $nodeVersionText；需要 22.12 或更新版本。" }

    $gitStatus = @(& $gitCommand.Source status --porcelain --untracked-files=normal)
    if ($LASTEXITCODE -ne 0) { throw '无法读取 Git 工作区状态。' }
    if ($gitStatus.Count -gt 0) {
        Write-Host '工作区有未提交的更改：' -ForegroundColor Yellow
        $gitStatus | ForEach-Object { Write-Host "  $_" }
        throw '请先提交并推送所有源码更改，再运行一键发布。'
    }

    $branch = (& $gitCommand.Source branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0) { throw '无法读取当前 Git 分支。' }
    if ($branch -ne 'main') { throw "请切换到 main 分支后再发布；当前分支为 $branch。" }

    Invoke-CheckedCommand -FilePath $gitCommand.Source -Arguments @('fetch', 'origin', 'main') -Description '同步 origin/main'
    $aheadBehind = (& $gitCommand.Source rev-list --left-right --count origin/main...HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw '无法比较本地 main 与 origin/main。' }
    $aheadBehindParts = $aheadBehind -split '\s+'
    if ($aheadBehindParts.Count -ne 2 -or $aheadBehindParts[0] -ne '0' -or $aheadBehindParts[1] -ne '0') {
        throw '本地 main 与 origin/main 不一致。请先同步分支后再发布。'
    }

    Invoke-CheckedCommand -FilePath $ghCommand.Source -Arguments @('auth', 'status') -Description '检查 GitHub CLI 登录状态'
    $repository = (& $ghCommand.Source repo view --json nameWithOwner --jq .nameWithOwner).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repository)) {
        throw '无法从当前 Git 仓库识别 GitHub 项目；请确认 origin 指向 GitHub 仓库且账号有写入权限。'
    }

    $databasePath = Join-Path $projectRoot 'data/pokedex.sqlite'
    $manifestPath = Join-Path $projectRoot 'data/manifest.json'
    if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw '图鉴离线资料尚未准备好。请按 README 的资料准备步骤完成导入后再发布。'
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
    if ([int]$manifest.speciesCount -lt 1) { throw '图鉴资料清单中没有宝可梦记录。' }
    if ([int]$manifest.imageCounts.artwork -lt 1) { throw '尚未准备宝可梦图片资源；请完成图片资料导入后再发布。' }

    $packagePath = Join-Path $projectRoot 'package.json'
    $package = Get-Content -LiteralPath $packagePath -Encoding UTF8 -Raw | ConvertFrom-Json
    $currentVersion = [string]$package.version
    if ($currentVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw "package.json 版本号不是支持的 x.y.z 格式：$currentVersion"
    }

    $versionInput = Read-Host "请输入本次版本号 x.y.z [默认 $currentVersion]"
    $targetVersion = if ([string]::IsNullOrWhiteSpace($versionInput)) { $currentVersion } else { $versionInput.Trim() }
    if ($targetVersion.StartsWith('v', [System.StringComparison]::OrdinalIgnoreCase)) {
        $targetVersion = $targetVersion.Substring(1)
    }
    if ($targetVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw "版本号格式无效：$targetVersion。请输入 x.y.z，例如 0.1.2。"
    }
    if ([version]::Parse($targetVersion) -lt [version]::Parse($currentVersion)) {
        throw "版本号不能低于当前版本 $currentVersion。"
    }

    $tag = "v$targetVersion"
    $tagRef = "refs/tags/$tag"
    $peeledTagRef = "$tagRef^{}"
    $localTag = @(& $gitCommand.Source tag --list $tag)
    if ($LASTEXITCODE -ne 0) { throw '无法检查本地是否已有同名版本标签。' }
    if ($localTag.Count -gt 0) { throw "本地已经存在标签 $tag。请改用新的版本号。" }
    $existingTag = @(& $gitCommand.Source ls-remote --tags origin $tagRef $peeledTagRef)
    if ($LASTEXITCODE -ne 0) { throw '无法检查 GitHub 上是否已有同名版本标签。' }
    if ($existingTag.Count -gt 0) { throw "GitHub 上已经存在标签 $tag。请改用新的版本号。" }

    $defaultTitle = "Pokedex $tag (Windows x64)"
    $titleInput = Read-Host "请输入 Release 标题 [默认 $defaultTitle]"
    $title = if ([string]::IsNullOrWhiteSpace($titleInput)) { $defaultTitle } else { $titleInput.Trim() }
    if ([string]::IsNullOrWhiteSpace($title)) { throw 'Release 标题不能为空。' }

    Write-Host '输入发布说明，每行输入一条；空行结束。直接回车将使用默认说明。'
    $noteLines = [System.Collections.Generic.List[string]]::new()
    while ($true) {
        $noteLine = Read-Host '说明'
        if ([string]::IsNullOrWhiteSpace($noteLine)) { break }
        $noteLines.Add($noteLine)
    }
    $notes = if ($noteLines.Count -gt 0) {
        $noteLines -join [Environment]::NewLine
    } else {
        "宝可梦图鉴 $tag · Windows x64 桌面版。下载 ZIP 并解压后，运行 Pokedex.exe。"
    }

    $isPrerelease = Read-YesNo -Prompt '是否标记为预发布版本？' -Default $false
    $isDraft = Read-YesNo -Prompt '是否先保存为草稿，不立即公开？' -Default $false

    $archivePath = Join-Path $projectRoot "release/Pokedex-$targetVersion-win64.zip"
    Write-Host ''
    Write-Host '发布内容预览' -ForegroundColor Cyan
    Write-Host "仓库：$repository"
    Write-Host "分支：main"
    Write-Host "版本：$targetVersion（标签 $tag）"
    Write-Host "标题：$title"
    Write-Host "状态：$(if ($isDraft) { '草稿' } else { '立即发布' })$(if ($isPrerelease) { ' · 预发布' } else { '' })"
    Write-Host "附件：$archivePath"
    Write-Host '说明：'
    Write-Host $notes
    if ($targetVersion -ne $currentVersion) {
        Write-Host "确认后会将应用版本更新为 $targetVersion，并只把版本快照推送到标签 $tag；main 分支保持不变。"
    }
    $confirmation = Read-Host '确认后输入 PUBLISH 开始构建和上传'
    if ($confirmation -cne 'PUBLISH') {
        throw [System.OperationCanceledException]::new('已取消；尚未修改版本、构建或上传。')
    }

    if ($targetVersion -ne $currentVersion) {
        $versionUpdateStarted = $true
        Invoke-CheckedCommand -FilePath $npmCommand.Source -Arguments @('version', $targetVersion, '--no-git-tag-version', '--ignore-scripts') -Description '更新应用版本'
        $updatedPackage = Get-Content -LiteralPath $packagePath -Encoding UTF8 -Raw | ConvertFrom-Json
        if ([string]$updatedPackage.version -ne $targetVersion) { throw 'package.json 版本更新后校验失败。' }
    }

    $packagingBatch = Join-Path $projectRoot '一键打包.bat'
    & $packagingBatch --no-pause
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -ne 0) { throw "一键打包失败，退出码 $buildExitCode。" }

    $executablePath = Join-Path $projectRoot 'release/Pokedex-win32-x64/Pokedex.exe'
    if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) { throw '打包后找不到 Pokedex.exe。' }
    $archiveExists = Test-Path -LiteralPath $archivePath -PathType Leaf
    $archiveNeedsRefresh = -not $archiveExists
    if ($archiveExists) {
        $archiveNeedsRefresh = (Get-Item -LiteralPath $archivePath).LastWriteTimeUtc -lt (Get-Item -LiteralPath $executablePath).LastWriteTimeUtc
    }
    if ($archiveNeedsRefresh) {
        $compressScript = Join-Path $projectRoot 'scripts/compress-release.ps1'
        Invoke-CheckedCommand -FilePath (Get-Command powershell.exe).Source -Arguments @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $compressScript) -Description '压缩桌面版文件夹'
    }
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw "没有生成发行包：$archivePath" }
    $archive = Get-Item -LiteralPath $archivePath
    if ($archive.Length -lt 1) { throw '发行 ZIP 文件为空。' }
    if ($archive.Length -ge 2GB) { throw '发行 ZIP 达到或超过 GitHub Release 的单文件大小限制 2 GiB。' }

    $releaseParent = (& $gitCommand.Source rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw '无法读取发布提交编号。' }
    $releaseCommit = $releaseParent
    if ($targetVersion -ne $currentVersion) {
        Invoke-CheckedCommand -FilePath $gitCommand.Source -Arguments @('add', '--', 'package.json', 'package-lock.json') -Description '暂存版本号快照'
        $releaseTree = (& $gitCommand.Source write-tree).Trim()
        if ($LASTEXITCODE -ne 0) { throw '无法生成发布版本快照。' }
        $releaseCommit = (& $gitCommand.Source commit-tree $releaseTree -p $releaseParent -m "chore: release $tag").Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releaseCommit)) { throw '无法创建发布标签对应的版本快照。' }
        Invoke-CheckedCommand -FilePath $gitCommand.Source -Arguments @('restore', '--source=HEAD', '--staged', '--worktree', '--', 'package.json', 'package-lock.json') -Description '恢复 main 工作区版本号'
    }

    $statusAfterRestore = @(& $gitCommand.Source status --porcelain --untracked-files=normal)
    if ($LASTEXITCODE -ne 0) { throw '无法确认 main 工作区状态。' }
    if ($statusAfterRestore.Count -gt 0) { throw '版本快照生成后工作区仍有更改；为避免影响 main，已停止发布。' }

    Invoke-CheckedCommand -FilePath $gitCommand.Source -Arguments @('tag', '-a', $tag, $releaseCommit, '-m', "Release $tag") -Description '创建本地版本标签'
    $releaseTagCreated = $true
    Invoke-CheckedCommand -FilePath $gitCommand.Source -Arguments @('push', 'origin', "refs/tags/$tag") -Description '推送版本标签'
    $releaseTagPushed = $true

    $releaseArguments = @('release', 'create', $tag, $archivePath, '--repo', $repository, '--title', $title, '--notes', $notes, '--verify-tag')
    if ($isPrerelease) { $releaseArguments += '--prerelease' }
    if ($isDraft) { $releaseArguments += '--draft' }
    Invoke-CheckedCommand -FilePath $ghCommand.Source -Arguments $releaseArguments -Description '创建 GitHub Release 并上传 ZIP'

    $releaseUrl = (& $ghCommand.Source release view $tag --repo $repository --json url --jq .url).Trim()
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($releaseUrl)) {
        Write-Host "发布完成：$releaseUrl" -ForegroundColor Green
    } else {
        Write-Host "Release $tag 已创建；可在 GitHub 的 Releases 页面查看。" -ForegroundColor Green
    }
    $exitCode = 0
} catch [System.OperationCanceledException] {
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    $exitCode = 0
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    if ($releaseTagCreated -and -not $releaseTagPushed) {
        try {
            Invoke-CheckedCommand -FilePath (Get-Command git.exe).Source -Arguments @('tag', '-d', $tag) -Description '删除未推送的本地发布标签'
        } catch {
            Write-Host "[WARN] 未能删除本地标签 $tag：$($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    if ($versionUpdateStarted -and -not $releaseTagPushed -and $currentVersion) {
        try {
            Invoke-CheckedCommand -FilePath (Get-Command git.exe).Source -Arguments @('restore', '--source=HEAD', '--staged', '--worktree', '--', 'package.json', 'package-lock.json') -Description '恢复 main 工作区版本号'
            Write-Host "已恢复 main 工作区的版本号 $currentVersion。" -ForegroundColor Yellow
        } catch {
            Write-Host "[WARN] 自动恢复版本号失败：$($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    if ($releaseTagPushed) {
        Write-Host "标签 $tag 已推送，main 分支未修改。若 Release 创建未完成，请检查 GitHub 的标签和 Releases 页面。" -ForegroundColor Yellow
    }
    $exitCode = 1
} finally {
    Pop-Location
}

exit $exitCode
