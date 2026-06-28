#!/usr/bin/env bash
# ============================================================================
# CodexApp Broker — 一键部署 (Ubuntu / Debian)
#
#   在一台有公网域名、DNS 已指向本机的服务器上,用 root 运行:
#     sudo bash cloud/deploy.sh
#   或先下载:
#     curl -fsSL https://raw.githubusercontent.com/LuckyYouStudio/CodexAPP/main/cloud/deploy.sh -o deploy.sh && sudo bash deploy.sh
#
# 装 Node22 + Caddy,拉代码,配 env,起 systemd 常驻,Caddy 自动 HTTPS。
# 可重复运行(再次运行 = 更新代码 + 重启)。
# 非交互:预先 export DOMAIN/ADMIN_EMAIL/SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM/ADMIN_TOKEN
# ADMIN_TOKEN 不设则自动随机生成(并在结尾打印);重复运行会保留已有令牌。
# 国内服务器(GitHub 不通)可用镜像:
#   REPO=https://ghproxy.net/https://github.com/LuckyYouStudio/CodexAPP.git \
#   NPM_REGISTRY=https://registry.npmmirror.com  sudo -E bash deploy.sh
#   (Caddy 若 apt 源不通会自动改用二进制;必要时再 export CADDY_URL=可下载的二进制地址)
# ============================================================================
set -euo pipefail

REPO="${REPO:-https://github.com/LuckyYouStudio/CodexAPP.git}"
APP_DIR="${APP_DIR:-/opt/codexapp}"
DATA_DIR="${DATA_DIR:-/opt/codexapp/data}"
SERVICE="codexapp-broker"
ENV_FILE="/etc/codexapp/broker.env"
RUN_USER="codexapp"

[ "$(id -u)" = "0" ] || { echo "请用 root 运行:  sudo bash cloud/deploy.sh"; exit 1; }

# ---- 收集配置(已 export 的跳过提问) ----
[ -n "${DOMAIN:-}" ]      || read -rp "Broker 域名 (例 broker.yourdomain.com): " DOMAIN
[ -n "${ADMIN_EMAIL:-}" ] || read -rp "管理员邮箱 (HTTPS 证书通知用): " ADMIN_EMAIL
if [ -z "${SMTP_HOST:-}" ]; then
  echo "SMTP(发验证邮件;直接回车可跳过,之后改 $ENV_FILE):"
  read -rp "  SMTP_HOST: " SMTP_HOST || true
  read -rp "  SMTP_PORT [587]: " SMTP_PORT || true;  SMTP_PORT="${SMTP_PORT:-587}"
  read -rp "  SMTP_USER: " SMTP_USER || true
  read -rsp "  SMTP_PASS: " SMTP_PASS || true; echo
  read -rp "  SMTP_FROM [no-reply@$DOMAIN]: " SMTP_FROM || true
fi
SMTP_FROM="${SMTP_FROM:-no-reply@$DOMAIN}"
[ -n "$DOMAIN" ] || { echo "域名不能为空"; exit 1; }

export DEBIAN_FRONTEND=noninteractive

# ---- Node >= 22 ----
need_node=1
if command -v node >/dev/null 2>&1; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  echo "[*] 安装 Node 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# ---- git ----
command -v git >/dev/null 2>&1 || { apt-get update -y; apt-get install -y git; }

# ---- Caddy(自动 HTTPS 反代) ----
if ! command -v caddy >/dev/null 2>&1; then
  echo "[*] 安装 Caddy ..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg || true
  # 主路:cloudsmith apt 源(海外快;国内可能不稳,失败则走二进制兜底)
  if curl -1sLf -m 20 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' 2>/dev/null | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null; then
    curl -1sLf -m 20 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null || true
    apt-get update -y >/dev/null 2>&1 && apt-get install -y caddy || true
  fi
  # 兜底:直接下二进制 + 自建 systemd 服务(CADDY_URL 可覆盖,默认官方下载)
  if ! command -v caddy >/dev/null 2>&1; then
    echo "[*] apt 源不可达,改用二进制安装 Caddy ..."
    curl -fsSL -m 120 -o /usr/bin/caddy "${CADDY_URL:-https://caddyserver.com/api/download?os=linux&arch=amd64}"
    chmod +x /usr/bin/caddy
    id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
    mkdir -p /etc/caddy
    cat > /etc/systemd/system/caddy.service <<'CADDYEOF'
[Unit]
Description=Caddy
After=network.target network-online.target
Requires=network-online.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-abnormal
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
CADDYEOF
    systemctl daemon-reload; systemctl enable caddy
  fi
fi

# ---- 拉取/更新代码 ----
if [ -d "$APP_DIR/.git" ]; then
  echo "[*] 更新代码 ..."; git -C "$APP_DIR" pull --ff-only
else
  echo "[*] 拉取代码 ..."; git clone --depth 1 "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
REG="${NPM_REGISTRY:-https://registry.npmjs.org}"
echo "[*] 安装依赖 (registry: $REG) ..."; (npm ci --omit=dev --registry "$REG" 2>/dev/null || npm install --omit=dev --registry "$REG")

# ---- 运行用户 + 数据目录 ----
id -u "$RUN_USER" >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin "$RUN_USER"
mkdir -p "$DATA_DIR"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR" "$DATA_DIR"

# ---- 管理后台令牌(保留已有,否则随机生成) ----
if [ -z "${ADMIN_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  ADMIN_TOKEN="$(grep -E '^ADMIN_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
[ -n "${ADMIN_TOKEN:-}" ] || ADMIN_TOKEN="$(openssl rand -hex 16 2>/dev/null || head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# ---- env 文件(含 SMTP 密码 + 管理令牌,仅 root 可读) ----
mkdir -p /etc/codexapp
cat > "$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=8787
PUBLIC_URL=https://$DOMAIN
DB_PATH=$DATA_DIR/codexapp.db
ADMIN_TOKEN=$ADMIN_TOKEN
SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-587}
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
SMTP_FROM=$SMTP_FROM
EOF
chmod 600 "$ENV_FILE"

# ---- systemd 服务 ----
NODE_BIN="$(command -v node)"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=CodexApp Broker
After=network.target

[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN cloud/broker.mjs
Restart=always
RestartSec=3
User=$RUN_USER
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

# ---- Caddy 反代 + 自动 HTTPS ----
cat > /etc/caddy/Caddyfile <<EOF
{
	email $ADMIN_EMAIL
}
$DOMAIN {
	reverse_proxy 127.0.0.1:8787
}
EOF
systemctl restart caddy

# ---- 防火墙(best-effort) ----
if command -v ufw >/dev/null 2>&1; then ufw allow 80,443/tcp >/dev/null 2>&1 || true; fi

echo
echo "==================== 部署完成 ===================="
echo "网页 / Broker : https://$DOMAIN/"
echo "管理后台      : https://$DOMAIN/admin"
echo "管理员令牌    : $ADMIN_TOKEN"
echo "                (在 $ENV_FILE 的 ADMIN_TOKEN,可改后 systemctl restart $SERVICE)"
echo "服务状态      : systemctl status $SERVICE"
echo "实时日志      : journalctl -u $SERVICE -f"
echo "改配置        : 编辑 $ENV_FILE 后  systemctl restart $SERVICE"
echo "更新代码      : 再次运行本脚本(git pull + 重启)"
if [ -z "${SMTP_HOST:-}" ]; then
  echo
  echo "⚠ 未配置 SMTP:验证邮件发不出去(链接只会进日志)。"
  echo "  最简单:打开 https://$DOMAIN/admin 用上面的令牌登录,在「SMTP 设置」里填(即时生效,免重启)。"
fi
echo "=================================================="
echo
echo "下一步:用户访问 https://$DOMAIN/ 注册→验证邮箱→登录;"
echo "        电脑端装 Agent(Install.cmd,Broker 地址填 https://$DOMAIN)登录同账号即可匹配。"
