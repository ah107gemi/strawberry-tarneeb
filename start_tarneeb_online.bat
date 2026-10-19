@echo off
title Strawberry Tarneeb - Online Card Game
cd /d "%~dp0"

:loop
cls
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

echo.
echo ====================================================
echo [!] Server or tunnel process ended.
echo ====================================================
echo.
echo Press any key to restart Strawberry Tarneeb, or close this window to exit.
pause >nul
goto loop
