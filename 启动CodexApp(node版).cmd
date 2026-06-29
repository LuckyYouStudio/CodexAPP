@echo off
chcp 65001 >nul
title CodexApp 电脑客户端 (node 版)
cd /d "%~dp0"
echo 正在启动 CodexApp 电脑客户端...
echo (用受信任的 node 运行，不会被智能应用控制 SAC 拦截；面板会自动打开)
echo 关闭此黑窗口即退出。
echo.
node cloud\agent.mjs
echo.
echo CodexApp 已退出。按任意键关闭。
pause >nul
