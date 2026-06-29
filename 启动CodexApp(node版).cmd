@echo off
title CodexApp (node)
cd /d "%~dp0"
echo Starting CodexApp client...
echo (runs via trusted node; Smart App Control won't block it; the panel opens automatically)
echo Close this window to quit.
echo.
node cloud\agent.mjs
echo.
echo CodexApp exited. Press any key to close.
pause >nul
