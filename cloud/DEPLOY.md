# 部署 CodexApp Broker（生产）

你只需要部署 **Broker**（一台小服务器）。Agent 跑在用户电脑、App 在用户手机——它们都**主动外连**你的 Broker，所以 Broker 只要有个公网域名 + HTTPS 即可。

## 准备

- 一台 VPS（1 核 512MB 起步就够，Broker 很轻）
- 一个域名指向它，例如 `broker.yourdomain.com`
- **Node ≥ 22**（Broker 用内置 `node:sqlite` 存账号）
- 一个发信渠道（SMTP / SendGrid / Mailgun / SES…）用于发验证邮件

## 一键部署（推荐）

在服务器上(域名 DNS 已指向它),用 root 运行:
```bash
curl -fsSL https://raw.githubusercontent.com/LuckyYouStudio/CodexAPP/main/cloud/deploy.sh -o deploy.sh
sudo bash deploy.sh        # 按提示填:域名、管理员邮箱、SMTP
```
脚本自动:装 Node22 + Caddy → 拉代码 → 配 `/etc/codexapp/broker.env`(含随机生成的 `ADMIN_TOKEN`)→ systemd 常驻 Broker → Caddy 自动 HTTPS。完成后访问 `https://你的域名/` 即网页客户端,`https://你的域名/admin` 是**管理后台**(脚本结尾会打印管理员令牌)。再次运行 = 更新代码 + 重启(保留原令牌)。

下面是手动步骤(想自己控制时参考)。

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
HOST=127.0.0.1 PORT=8787 PUBLIC_URL=https://broker.yourdomain.com node cloud/broker.mjs
```
Caddy 负责对外的 `https/wss`。WebSocket 升级 Caddy 默认透传，无需额外配置。

## 方式 B：Broker 原生 TLS

用 certbot 拿证书，直接让 Broker 监听 443：
```bash
sudo certbot certonly --standalone -d broker.yourdomain.com
sudo HOST=0.0.0.0 PORT=443 PUBLIC_URL=https://broker.yourdomain.com \
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
Environment=HOST=127.0.0.1 PORT=8787 PUBLIC_URL=https://broker.yourdomain.com ADMIN_TOKEN=换成够长的随机串
Environment=SMTP_HOST=smtp.yourprovider.com SMTP_PORT=587 SMTP_USER=apikey SMTP_PASS=*** SMTP_FROM=no-reply@yourdomain.com
ExecStart=/usr/bin/node cloud/broker.mjs
Restart=always
User=codexapp

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now codexapp-broker
```

## 管理后台

访问 `https://broker.yourdomain.com/admin`,用 `ADMIN_TOKEN`(在 `broker.env`,一键部署会随机生成并在结尾打印)登录。功能:

- **SMTP 设置**:可视化填发信邮箱(主机/端口/用户名/密码/发件人/TLS),**保存即时生效,无需重启**,带「测试连接」。这是配发验证邮件最省事的方式 —— 不必去服务器改 env。
- **会员兑换码**:批量生成卡密(30/90/180/365 天或永久 + 备注),复制给用户;查看已生成/已用统计。
- **概览**:总用户 / 已验证 / **活跃会员** / 当前在线账号(电脑端、客户端是否在线)。
- **用户管理**:手动标记验证、重发验证邮件、**+30 天 / 永久 / 取消会员**、删除账号(并断开其连接)。

> SMTP 优先级:后台填的值(存在数据库)**覆盖** env 里的 `SMTP_*`。即未配 env 也行,登录后台填即可。
> 没设 `ADMIN_TOKEN` 时 `/admin` 接口返回「admin 未启用」,纯手动部署记得在 `broker.env` 加一行 `ADMIN_TOKEN=<够长的随机串>`。

## 会员 / 收费（兑换码模式）

- **局域网直连模式永久免费**(不经过 Broker)。**云端(随处可用)需要会员**——gate 在 Broker 的 `/link` 上,电脑端 Agent 与手机/网页客户端都受控。
- **新用户注册自动送 7 天试用**(`TRIAL_DAYS` 可调,设 `0` 关闭)。
- 收费流程:你在 `/admin` **生成兑换码** → 用户在你的渠道(闲鱼/微信/淘宝…)付款拿到码 → 在客户端「开通云端会员」里输入码激活。真实收款在平台外完成,Broker 不接触支付。
- 兑换码**一次性**;续费会**叠加**在剩余时长之上;「永久」= 截止 2100 年。
- 想直接开通某账号(内测/客服):后台用户表点 **+30 天 / 永久**。

## 客户端怎么填

- **手机 App**（云账号模式）：Broker 地址填 `https://broker.yourdomain.com`，WS 自动走 `wss://`。
- **PC Agent**（`agent.config.json`）：`"brokerUrl": "https://broker.yourdomain.com"`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `0.0.0.0` | 监听地址（Caddy 模式设 `127.0.0.1`） |
| `PORT` | `8787` | 端口 |
| `TLS_CERT` / `TLS_KEY` | 空 | PEM 路径；都设了才走 https/wss，否则 http/ws |
| `PUBLIC_URL` | 自动推断 | 验证邮件里链接的域名，例 `https://broker.yourdomain.com`（Caddy 后建议显式设） |
| `DB_PATH` | `cloud/codexapp.db` | SQLite 账号库路径 |
| `ADMIN_TOKEN` | 空 | 设了才启用 `/admin` 管理后台；登录令牌 |
| `TRIAL_DAYS` | `7` | 新用户注册赠送的云端试用天数（`0` = 不送，注册后即需会员） |
| `SMTP_HOST` / `SMTP_PORT` | 空 | 发信服务器；**不设则验证链接只打到日志**（dev）。后台填的值会覆盖这里 |
| `SMTP_USER` / `SMTP_PASS` | 空 | 发信认证 |
| `SMTP_FROM` | = `SMTP_USER` | 发件人地址 |
| `SMTP_FROM_NAME` | 空 | 发件人显示名（后台「发件人名称」） |

示例（带发信）：
```bash
HOST=127.0.0.1 PORT=8787 PUBLIC_URL=https://broker.yourdomain.com \
  SMTP_HOST=smtp.sendgrid.net SMTP_PORT=587 SMTP_USER=apikey SMTP_PASS=*** \
  SMTP_FROM="CodexApp <no-reply@yourdomain.com>" node cloud/broker.mjs
```

## 生产清单（重要）

- **配 SMTP**（否则验证邮件发不出去，用户无法激活）。最省事:进 `/admin` → SMTP 设置 填写(即时生效)。本地不配时验证链接会打到 Broker 日志，仅供测试。
- **设 `ADMIN_TOKEN`** 并妥善保管(一键部署已自动随机生成);它能进后台改 SMTP、删用户。
- 账号库已是 **SQLite + JWT（带过期）+ 邮箱验证 + 登录限流**。备份 `codexapp.db` 和 `broker.secret`。
- 防火墙只放行 443（和 SSH）。
- Broker 看不到用户内容（端到端加密），但它是配对路由点——保证它本身不被入侵。
- 找回密码已就绪：登录页「忘记密码」→ 邮件链接 → `/reset` 设新密码（链接 1 小时有效，配 SMTP 才发得出；未配则链接打到日志）。
- 会员收费已就绪（兑换码）：局域网免费、云端收费、注册送 `TRIAL_DAYS` 天试用；账号+会员+兑换码都在 `codexapp.db` 里，备份它即可。
- 仍待接入：APNs 推送（审批提醒）、计费/订阅。

> 端到端加密 + 配对码已在协议层做好：即使 Broker 被攻破，也读不到内容，也无法冒充 Agent（配对码 SAS 校验）。详见 [README.md](README.md)。
