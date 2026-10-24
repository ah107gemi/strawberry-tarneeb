@echo off
title Strawberry Tarneeb Scoreboard
echo ====================================================
echo Starting Strawberry Tarneeb Scoreboard...
echo ====================================================
echo.
echo Opening app in your default browser...
start http://localhost:8085/
echo.
echo Running local web server on http://localhost:8085/
echo Press Ctrl+C in this window to stop the server.
echo.
python -m http.server 8085
pause
