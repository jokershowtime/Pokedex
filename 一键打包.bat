@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title 宝可梦图鉴 - 一键打包

pushd "%~dp0"
if errorlevel 1 goto location_error

echo 宝可梦图鉴：编译、打包、生成 ZIP
echo 请先关闭正在运行的图鉴，以免成品文件被占用。
echo.

set "package_step=检查 Node.js 和 npm"
where node.exe >nul 2>&1
if errorlevel 1 goto node_error
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_error
node.exe -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>22 || (v[0]===22 && v[1]>=12) ? 0 : 1);"
if errorlevel 1 goto node_error
if not exist "package.json" goto project_error

set "package_step=安装项目依赖"
if not exist "node_modules\.bin\vite.cmd" goto install_dependencies
if not exist "node_modules\.bin\tsc.cmd" goto install_dependencies
if not exist "node_modules\@electron\packager\package.json" goto install_dependencies
if not exist "node_modules\electron\package.json" goto install_dependencies
goto prepare_data

:install_dependencies
echo [1/4] 安装缺少的项目依赖，首次安装需要联网...
call npm.cmd ci --cache ".npm-cache" --no-audit --no-fund
if errorlevel 1 goto failed

:prepare_data
set "package_step=准备离线资料"
echo [1/4] 检查离线资料...
if not exist "data\pokedex.sqlite" goto import_data
if not exist "data\manifest.json" goto import_data
if not exist "public\assets\artwork\25.png" goto import_data
goto prepare_icon

:import_data
if not exist "..\pokeapi\data\v2\csv\pokemon.csv" goto data_error
where python.exe >nul 2>&1
if errorlevel 1 goto python_error
echo 从相邻 pokeapi 仓库整理资料和图片...
call npm.cmd run data:import --cache ".npm-cache"
if errorlevel 1 goto failed

:prepare_icon
set "package_step=准备程序图标"
if exist "data\app-icon.ico" goto prepare_electron
where python.exe >nul 2>&1
if errorlevel 1 goto python_error
python.exe "scripts\make_icon.py"
if errorlevel 1 goto failed

:prepare_electron
set "package_step=准备 Electron 运行时"
echo [2/4] 检查 Electron 运行时...
if exist "node_modules\electron\dist\electron.exe" goto build_release
set "electron_config_cache=%cd%\.electron-cache"
node.exe "node_modules\electron\install.js"
if errorlevel 1 goto failed

:build_release
set "package_step=编译和打包 Windows 桌面版"
echo [3/4] 编译界面并打包 Windows x64 程序...
call npm.cmd run package --cache ".npm-cache"
if errorlevel 1 goto failed

set "package_step=生成版本 ZIP"
echo [4/4] 压缩完整成品目录，生成带版本号的 ZIP...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\compress-release.ps1"
if errorlevel 1 goto failed

echo.
echo [完成] 成品程序："%cd%\release\Pokedex-win32-x64\Pokedex.exe"
echo [完成] 发布 ZIP 已生成在 release 目录中。
set "package_exit=0"
goto finish

:node_error
echo [错误] 需要 Node.js 22.12 或更新版本，以及 npm。安装后重新双击本脚本。
goto failed
:project_error
echo [错误] 找不到 package.json，请将本脚本保留在项目根目录中。
goto failed
:data_error
echo [错误] 离线资料尚未生成，也找不到相邻的 pokeapi 仓库。
echo 请先准备 pokeapi 仓库，或手动执行数据导入后重试。
goto failed
:python_error
echo [错误] 首次整理离线资料或生成图标需要 Python。图标生成还需要 Pillow。
goto failed
:failed
echo.
echo [失败] 当前步骤：%package_step%
echo 请查看上面的错误信息。关闭正在运行的图鉴后，可以重新打包。
set "package_exit=1"
:finish
popd
if /I not "%~1"=="--no-pause" pause
exit /b %package_exit%

:location_error
echo [错误] 无法进入本脚本所在的项目目录。
if /I not "%~1"=="--no-pause" pause
exit /b 1
