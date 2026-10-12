@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title 宝可梦图鉴 - 发布 Windows 版本

pushd "%~dp0"
if errorlevel 1 exit /b 1

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-release.ps1"
set "release_exit=%errorlevel%"
echo.
if /I not "%~1"=="--no-pause" pause
popd
exit /b %release_exit%
