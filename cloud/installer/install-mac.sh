#!/usr/bin/env bash
# CodexApp Agent —— macOS 安装(后台自启 + 控制面板登录)
# 用法:把 CodexApp-Agent(在 Mac 上 `node cloud/build-agent.mjs` 生成)和本脚本
# 放在一起,然后:  bash install-mac.sh
set -euo pipefail

APP="CodexApp-Agent"
SRC="$(cd "$(dirname "$0")" && pwd)/$APP"
DIR="$HOME/Library/Application Support/CodexAppAgent"
LA_DIR="$HOME/Library/LaunchAgents"
PLIST="$LA_DIR/com.codexapp.agent.plist"
LABEL="com.codexapp.agent"

echo "==== CodexApp Agent 安装 (macOS) ===="
if [ ! -f "$SRC" ]; then
  echo "找不到 $APP(请和本脚本放在同一文件夹)。"
  echo "在 Mac 上生成方法:  git clone 仓库 → npm install → node cloud/build-agent.mjs"
  echo "(或不打包,直接跑源码:  node cloud/agent.mjs)"
  exit 1
fi

mkdir -p "$DIR" "$LA_DIR"
cp "$SRC" "$DIR/$APP"
chmod +x "$DIR/$APP"
xattr -dr com.apple.quarantine "$DIR/$APP" 2>/dev/null || true  # 清隔离,避免 Gatekeeper 拦
echo "已安装到: $DIR/$APP"

# 开机自启(LaunchAgent,登录即后台运行;CODEXAPP_NO_OPEN=1 不弹浏览器)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$DIR/$APP</string></array>
  <key>EnvironmentVariables</key><dict><key>CODEXAPP_NO_OPEN</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.err.log</string>
</dict></plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "已设置开机自启(后台运行,无窗口)。"

sleep 1
echo "正在打开控制面板登录…"
open "http://127.0.0.1:7878" 2>/dev/null || true
echo
echo "完成!在打开的面板里填 Broker 地址、邮箱、密码登录即可。"
echo "之后用手机/网页客户端登录同一账号,输入面板上的配对码 → 远程控制本机 Codex。"
echo "面板随时可访问: http://127.0.0.1:7878    卸载: bash uninstall-mac.sh"
