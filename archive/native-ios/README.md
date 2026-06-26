# CodexApp — iOS 客户端

原生 SwiftUI。连接共享中继（见根目录 [PROTOCOL.md](../PROTOCOL.md)），实现发提示词、
纠偏、叫停、审批卡片、状态流、本地通知。

> ⚠️ **需要 Mac + Xcode 才能编译/安装到 iPhone。** 你在 Windows 上无法直接 build。
> 选项：① 借/买一台 Mac；② 云 Mac（MacinCloud / MacStadium）；③ CI 的 macOS runner
> （GitHub Actions / Codemagic）。代码已写好，到 Mac 上即可构建。
> 没有 Mac 但想现在就用 iPhone → 直接用 **web 版 PWA**（[../web](../web)，Safari 添加到主屏幕）。

## 在 Mac 上构建

工程用 [XcodeGen](https://github.com/yonyz/XcodeGen) 的 `project.yml` 描述（纯文本，
不把 `.xcodeproj` 进版本库，避免合并冲突）。

```bash
brew install xcodegen          # 第一次
cd ios
xcodegen generate              # 生成 CodexApp.xcodeproj
open CodexApp.xcodeproj         # Xcode 打开
```

然后在 Xcode：选你的开发者签名（Signing & Capabilities → Team）→ 选真机/模拟器 → Run。
首次真机安装需要 Apple ID（免费个人签名即可，7 天有效；付费 99$/年可长期）。

App 启动后：填中继地址（如 `http://192.168.1.84:4123`）+ Token → 连接。

## 关键点

- `Info.plist` 里 `NSAppTransportSecurity.NSAllowsArbitraryLoads=true`：允许局域网
  `ws://`（明文）。远程请用 Tailscale 的 `wss://`。
- `NSLocalNetworkUsageDescription`：首次访问局域网会弹「本地网络」权限。
- 通知：启动时请求授权；Codex 请求审批时发本地通知。**注意**：iOS 会在后台挂起 App，
  WebSocket 断开后收不到通知；要做到关 App 也能收，需服务端 Web Push / APNs（后续）。
- 最低 iOS 16。

## 代码结构

```
ios/
├─ project.yml              # XcodeGen 工程描述
├─ gen-icon.mjs             # 生成 AppIcon（纯 Node）
└─ CodexApp/
   ├─ CodexAppApp.swift     # @main 入口
   ├─ ContentView.swift     # 设置页 / 主页面 路由
   ├─ MainView.swift        # 主页面 + 审批卡片 + 输入栏 + 设置
   ├─ RelayStore.swift      # URLSessionWebSocket + 状态 + 解析 + 通知
   ├─ Models.swift          # AppState / FeedEvent / Approval
   ├─ Theme.swift           # 配色
   └─ Assets.xcassets/      # AppIcon + AccentColor
```
