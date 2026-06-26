# CodexApp — Android 客户端

原生 Kotlin + Jetpack Compose。连接共享中继（见根目录 [PROTOCOL.md](../PROTOCOL.md)），
实现发提示词、纠偏、叫停、审批卡片、状态流、审批通知。

## 构建 / 运行（Windows 上即可）

1. 装 **Android Studio**（含 Android SDK）。
2. Android Studio → **Open** → 选 `CodexApp/android` 文件夹。
3. 首次打开会自动同步 Gradle 并补全 wrapper（需要联网下载 Gradle 8.11.1 + 依赖）。
4. 手机开 **USB 调试** 连电脑（或用模拟器）→ 点 **Run ▶**。
5. App 启动后：填中继地址（如 `http://192.168.1.84:4123`）+ Token → 连接。

> 纯命令行构建（已装好 SDK 且设置了 `ANDROID_HOME`）：
> 在 `android/` 下 `gradle wrapper` 生成 wrapper，然后 `./gradlew assembleDebug`，
> APK 在 `app/build/outputs/apk/debug/`。

## 关键点

- `usesCleartextTraffic=true`：允许局域网 `ws://`（明文）连接中继。生产/远程请用
  Tailscale 的 `wss://`（HTTPS）。
- 通知：首次启动会请求 `POST_NOTIFICATIONS`（Android 13+）。授权后，Codex 请求审批时
  会弹高优先级通知 + 震动。**注意**：当前 WebSocket 跑在 App 进程内，App 被系统杀死后
  收不到通知；要后台常驻需加前台服务（后续增强）。
- 版本：AGP 8.7.2 / Kotlin 2.0.21 / Compose BOM 2024.12.01 / minSdk 26 / targetSdk 35。

## 代码结构

```
app/src/main/java/com/codexapp/
├─ MainActivity.kt        # 入口：通知权限 + 自动连接 + 挂载 Compose
├─ RelayClient.kt         # OkHttp WebSocket + 自动重连
├─ RelayViewModel.kt      # 状态(StateFlow) + 消息解析 + 动作
├─ Models.kt              # AppState / FeedEvent / Approval
├─ NotificationHelper.kt  # 审批通知渠道
└─ ui/
   ├─ AppScreen.kt        # 设置页 + 主页面 + 审批卡片 + 输入栏 + 设置弹窗
   └─ Theme.kt            # 深色主题
```
