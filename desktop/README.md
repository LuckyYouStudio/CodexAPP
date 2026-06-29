# CodexApp 电脑客户端(原生桌面版 / Electron)

真正的桌面程序窗口(不是网页):内部运行 agent(连 Broker + 驱动本地 Codex),
界面在一个原生 Electron 窗口里显示。

## 开发运行
```bash
cd desktop
npm install
npm start          # 打包 agent + 启动 electron 窗口
```

## 打包成安装程序(Windows)
```bash
npm run dist       # 产出 dist/CodexApp-Setup-<version>.exe (NSIS 安装包)
```
> 在哪个系统上打包就出哪个系统的安装包(Electron 不能交叉编译)。macOS 上 `npm run dist` 需改用 mac target。

## 说明
- `build.mjs` 用 esbuild 把 `../cloud/agent.mjs` 打成 `agent.cjs`,由 Electron 主进程 require。
- 配置/密钥存在用户目录(`app.getPath("userData")`),不在安装目录。
- 云端 Broker 固定为 `https://broker.the5288.cn`;局域网模式不受影响。
- 未签名:Windows SmartScreen 首次会提示,正式发布请用代码签名证书。
