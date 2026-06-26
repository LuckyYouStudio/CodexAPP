# CodexApp 移动端（Expo / React Native）

一套代码，**iPhone 和 Android 都能跑**，在 Windows 上开发，无需 Mac / Xcode / Android Studio。
连接电脑上的[中继](../relay/server.mjs)，远程控制 Codex：发提示词、纠偏、叫停、审批、看状态。
协议见 [../PROTOCOL.md](../PROTOCOL.md)。

## 今天就能在真机上跑（Expo Go，最省事）

1. 电脑先启动中继（在仓库根目录）：
   ```powershell
   cd C:\test\CodexAPP
   npm start          # 打印局域网地址 + Token
   ```
2. 启动 Expo 开发服务（本目录）：
   ```powershell
   cd C:\test\CodexAPP\mobile
   npm install        # 第一次
   npx expo start
   ```
3. 手机装 **Expo Go**（App Store / Play 商店），和电脑同一 WiFi：
   - iPhone：用相机扫终端里的二维码 → 在 Expo Go 打开
   - Android：用 Expo Go 内的扫码功能扫
4. App 打开后：填**中继地址**（如 `http://192.168.1.84:4123`）+ **Token**，点连接。

> iPhone 和 Android 用的是**同一个中继地址 + Token**，跟网页端一样。

## 功能

- 连接门：中继地址 + Token（用 AsyncStorage 记住，下次免填）
- 发提示词 / 纠偏（steer）/ 叫停（interrupt）
- 审批卡片：批准 / 本会话都批准 / 拒绝
- 实时状态：running/idle、流式回复、命令执行、文件改动、错误
- 设置：工作目录 cwd、审批策略、沙箱；新建会话；开启审批通知
- 审批到达：震动 + 本地通知（需在设置里授权）

## 打包成可独立安装的 App（不依赖电脑开 Expo）

用 Expo 的云构建 **EAS**（Windows 上即可，无需 Mac）：

```powershell
npm install -g eas-cli
eas login
eas build -p android --profile preview   # 出 .apk，可直接装安卓
eas build -p ios --profile preview        # 出 iOS 包，需 Apple 开发者账号($99/年)
```

- **Android**：EAS 云构建 `.apk`，下载直接装，完全不用电脑工具链。
- **iOS**：EAS 也能云构建，但要 Apple 开发者账号来签名 / 装到 iPhone。

## 远程使用（不在同一 WiFi）

让中继走 Tailscale HTTPS（见根目录 README §远程访问），App 里把中继地址填成
`https://<机器名>.ts.net`，WebSocket 会自动走 `wss://`。

## 结构

```
mobile/
├─ App.js                 # 根：连接门 vs 主界面，凭证持久化
├─ src/
│  ├─ useRelay.js         # WS 连接 + 重连 + 消息分发 + 动作 + 审批通知
│  ├─ storage.js          # AsyncStorage 存中继地址/Token
│  ├─ theme.js            # 配色
│  ├─ SetupScreen.js      # 连接门
│  ├─ MainScreen.js       # 头部状态 + 事件流 + 审批 + 输入框
│  ├─ ApprovalCard.js     # 审批卡片
│  └─ SettingsModal.js    # 设置面板
└─ app.json               # Expo 配置
```

## 故障排查

- **扫码后连不上 Metro**：手机和电脑要同一 WiFi；或 `npx expo start --tunnel`（走隧道，跨网络）。
- **App 里连不上中继**：用电脑 `npm start` 打印的实际局域网 IP；放行防火墙 4123；中继要在运行。
- **状态卡在「中继已连，等待 Codex」**：中继没连上 codex，看中继终端日志。
- **收不到通知**：设置里点「开启审批通知」并在系统里允许。
