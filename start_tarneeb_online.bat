@echo off
title Strawberry Tarneeb - Online Card Game
cd /d "%~dp0"

echo ===================================================================
echo             STRAWBERRY TARNEEB - ONLINE CARD GAME
echo ===================================================================
echo.

:: Detect Python executable (support py or python)
set "PY_CMD=python"
py -m uvicorn --version >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "PY_CMD=py"
) else (
    python -m uvicorn --version >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        set "PY_CMD=python"
    ) else (
        if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" (
            set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
        )
    )
)

:: 1. Launch FastAPI uvicorn in a visible separate window
echo [1/3] Starting FastAPI backend server in a separate window...
start "Strawberry Backend" cmd /k %PY_CMD% -m uvicorn server:app --host 127.0.0.1 --port 8000

:: 2. Wait 3 seconds for server to bind
echo [2/3] Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

:: 3. Verify server health via PowerShell
echo [3/3] Checking server health at http://127.0.0.1:8000/healthz...
powershell -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:8000/healthz -UseBasicParsing).StatusCode } catch { exit 1 }"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ===================================================================
    echo [ERROR] Backend health check failed!
    echo Please inspect the 'Strawberry Backend' window for error messages.
    echo ===================================================================
    pause
    exit /b 1
)

echo.
echo [OK] Backend server is healthy!
echo.

:: Ensure cloudflared.exe exists
if not exist cloudflared.exe (
    echo [*] cloudflared.exe not found. Downloading Cloudflare Tunnel binary...
    %PY_CMD% download_cloudflared.py
)

:: 4. Start Cloudflare Tunnel pointing explicitly to IPv4 http://127.0.0.1:8000
echo ===================================================================
echo Starting Cloudflare Tunnel (pointing to http://127.0.0.1:8000)...
echo Look below for your public https://*.trycloudflare.com URL!
echo ===================================================================
echo.
cloudflared.exe tunnel --url http://127.0.0.1:8000

echo.
echo ===================================================================
echo [!] Cloudflare Tunnel closed.
echo ===================================================================
pause
