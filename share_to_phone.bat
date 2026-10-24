@echo off
title Strawberry Tarneeb - Phone Share Tunnel
echo ========================================================
echo   🍓 Strawberry Tarneeb Scoreboard - Mobile Tunnel
echo ========================================================
echo.
echo 1. Starting local web server on port 8085...
start /b python -m http.server 8085 > nul 2>&1
timeout /t 2 > nul

echo 2. Establishing secure public HTTPS tunnel for phone...
echo --------------------------------------------------------
echo Look for the https://....lhr.life link below:
echo (Open that link or scan the QR on your phone)
echo --------------------------------------------------------
echo.
ssh -R 80:localhost:8085 nokey@localhost.run -o StrictHostKeyChecking=no
pause
