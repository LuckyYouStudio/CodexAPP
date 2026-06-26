# 部署 CodexApp Broker（生产）

你只需要部署 **Broker**（一台小服务器）。Agent 跑在用户电脑、App 在用户手机——它们都**主动外连**你的 Broker，所以 Broker 只要有个公网域名 + HTTPS 即可。

## 准备

- 一台 VPS（1 核 512MB 起步就够，Broker 很轻）
- 一个域名指向它，例如 `broker.yourdomain.com`
- Node ≥ 18

## 方式 A：Caddy 自动 HTTPS（推荐，最省事）

让 Caddy 反向代理并自动签 Let's Encrypt 证书，Broker 本身只在本地跑明文。

```
# /etc/caddy/Caddyfile
broker.yourdomain.com {
    reverse_proxy 127.0.0.1:8787
}
```

Broker 本地起（明文，仅监听本机）：
```bash
HOST=127.0.0.1 PORT=8787 ALLOW_AUTOREGISTER=0 node cloud/broker.mjs
```
Caddy 负责对外的 `https/wss`。WebSocket 升级 Caddy 默认透传，无需额外配置。

## 方式 B：Broker 原生 TLS

用 certbot 拿证书，直接让 Broker 监听 443：
```bash
sudo certbot certonly --standalone -d broker.yourdomain.com
sudo HOST=0.0.0.0 PORT=443 ALLOW_AUTOREGISTER=0 \
  TLS_CERT=/etc/letsencrypt/live/broker.yourdomain.com/fullchain.pem \
  TLS_KEY=/etc/letsencrypt/live/broker.yourdomain.com/privkey.pem \
  node cloud/broker.mjs
```
启动日志会显示 `[https/wss]`。

## systemd 常驻

```ini
# /etc/systemd/system/codexapp-broker.service
[Unit]
Description=CodexApp Broker
After=network.target

[Service]
WorkingDirectory=/opt/codexapp
Environment=HOST=127.0.0.1 PORT=8787 ALLOW_AUTOREGISTER=0
ExecStart=/usr/bin/node cloud/broker.mjs
Restart=always
User=codexapp

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now codexapp-broker
```

## 客户端怎么填

- **手机 App**（云账号模式）：Broker 地址填 `https://broker.yourdomain.com`，WS 自动走 `wss://`。
- **PC Agent**（`agent.config.json`）：`"brokerUrl": "https://broker.yourdomain.com"`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `0.0.0.0` | 监听地址（Caddy 模式设 `127.0.0.1`） |
| `PORT` | `8787` | 端口 |
| `TLS_CERT` / `TLS_KEY` | 空 | PEM 路径；都设了才走 https/wss，否则 http/ws |
| `ALLOW_AUTOREGISTER` | `1` | **生产必须设 `0`**：关闭"登录即自动注册" |

## 生产清单（重要）

- **关闭 autoregister**（`ALLOW_AUTOREGISTER=0`），改用正式注册流程。
- 现在的账号库是最简 `accounts.json` + 内存 token：生产请换**数据库 + JWT/刷新令牌 + 邮箱验证**，并给登录加**速率限制**。
- 防火墙只放行 443（和 SSH）。
- `accounts.json` 当敏感数据备份/保护。
- Broker 看不到用户内容（端到端加密），但它是配对路由点——保证它本身不被入侵。
- 仍待接入：APNs 推送（审批提醒）、计费/订阅。

> 端到端加密 + 配对码已在协议层做好：即使 Broker 被攻破，也读不到内容，也无法冒充 Agent（配对码 SAS 校验）。详见 [README.md](README.md)。
