@echo off
title Sync Strawberry Tarneeb to GitHub Pages
cd /d "%~dp0"

echo ========================================================
echo   🍓 Syncing Strawberry Tarneeb to GitHub Pages...
echo ========================================================
echo.

set "PY_CMD=python"
python --version >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    py --version >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "PY_CMD=py"
    ) else (
        if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
            set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
        ) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
            set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
        )
    )
)

%PY_CMD% "%~dp0deploy_github.py" %*
echo.
pause
