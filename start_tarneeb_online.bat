@echo off
title Strawberry Tarneeb - Online Card Game
cd /d "%~dp0"
echo ====================================================
echo Starting Strawberry Tarneeb Online Multiplayer...
echo ====================================================
echo.

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py -3.14 tunnel_runner.py
) else (
    python tunnel_runner.py
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Server exited with an error.
    pause
)
