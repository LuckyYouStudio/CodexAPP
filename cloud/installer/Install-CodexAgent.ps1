# CodexApp Agent installer.
# Copies the agent exe to %LOCALAPPDATA%\CodexAppAgent, writes the account
# config on first run, registers hidden auto-start, and launches it.
$ErrorActionPreference = "Stop"
$ExeName = "CodexApp-Agent.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "CodexAppAgent"

Write-Host "==== CodexApp Agent 安装 ====" -ForegroundColor Cyan

# Locate the source exe (next to this script, or the dev dist/ folder).
$src = Join-Path $PSScriptRoot $ExeName
if (-not (Test-Path $src)) { $src = Join-Path $PSScriptRoot "..\..\dist\$ExeName" }
if (-not (Test-Path $src)) {
  Write-Host "找不到 $ExeName，请把它和本脚本放在同一文件夹。" -ForegroundColor Red
  Read-Host "按回车退出"; exit 1
}

New-Item -ItemType Directory -Force $InstallDir | Out-Null
$exe = Join-Path $InstallDir $ExeName
Copy-Item $src $exe -Force
Write-Host "已安装到: $exe"

# Account config (only ask on first install).
$cfgPath = Join-Path $InstallDir "agent.config.json"
if (-not (Test-Path $cfgPath)) {
  Write-Host "`n首次安装，请填写连接信息：" -ForegroundColor Yellow
  $broker = Read-Host "Broker 地址 (例 https://broker.yourdomain.com)"
  $email  = Read-Host "账号邮箱"
  $pass   = Read-Host "账号密码"
  $cwd    = Read-Host "默认项目目录 (回车用 C:\test)"
  if ([string]::IsNullOrWhiteSpace($cwd)) { $cwd = "C:\test" }
  $cfg = [ordered]@{
    brokerUrl = $broker; email = $email; password = $pass;
    codexBin = ""; defaultCwd = $cwd; approvalPolicy = "on-request";
    sandbox = "workspace-write"; model = $null
  }
  # Write UTF-8 WITHOUT BOM so Node's JSON.parse accepts it.
  [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json))
  Write-Host "配置已保存: $cfgPath"
} else {
  Write-Host "已存在配置，沿用: $cfgPath"
}

# Hidden auto-start: a .vbs in the Startup folder launches the exe with no window.
$startup = [Environment]::GetFolderPath("Startup")
$vbs = Join-Path $startup "CodexAppAgent.vbs"
# Set CODEXAPP_NO_OPEN so the background autostart doesn't pop a browser each boot
# (the panel is still reachable at http://127.0.0.1:7878).
$vbsContent = 'Dim sh: Set sh = CreateObject("Wscript.Shell")' + "`r`n" +
              'sh.Environment("Process")("CODEXAPP_NO_OPEN") = "1"' + "`r`n" +
              'sh.Run """' + $exe + '""", 0, False'
[IO.File]::WriteAllText($vbs, $vbsContent)
Write-Host "已设置开机自启 (隐藏窗口): $vbs"

# Start now (hidden), unless already running.
if (-not (Get-Process -Name "CodexApp-Agent" -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $exe -WindowStyle Hidden
  Write-Host "Agent 已在后台启动。"
} else {
  Write-Host "Agent 已在运行。"
}

Write-Host "`n完成！手机用同一账号登录即可控制这台电脑的 Codex。" -ForegroundColor Green
Write-Host "改配置请编辑: $cfgPath  （改完重启 Agent 或重新登录）"
Read-Host "按回车退出"
