@echo off
title MD Renderer - Offline Preparation
cd /d "%~dp0\.."

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies first...
    npm install
    echo.
)

echo Preparing offline vendor assets...
echo.
node scripts/prepare-offline.js %*

if %errorlevel% neq 0 (
    echo.
    echo Preparation failed.
    pause
    exit /b 1
)

echo.
pause
