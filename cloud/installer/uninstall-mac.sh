#!/usr/bin/env bash
# CodexApp Agent —— macOS 卸载
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.codexapp.agent.plist"
DIR="$HOME/Library/Application Support/CodexAppAgent"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
pkill -f "CodexAppAgent/CodexApp-Agent" 2>/dev/null || true
rm -rf "$DIR"
echo "已卸载 CodexApp Agent(已停止、删除自启与程序文件)。"
