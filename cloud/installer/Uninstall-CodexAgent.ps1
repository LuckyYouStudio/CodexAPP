# Stop the agent, remove auto-start, and delete installed files.
$ErrorActionPreference = "SilentlyContinue"
Write-Host "==== 卸载 CodexApp Agent ====" -ForegroundColor Cyan

Stop-Process -Name "CodexApp-Agent" -Force
$startup = [Environment]::GetFolderPath("Startup")
Remove-Item (Join-Path $startup "CodexAppAgent.vbs") -Force
$InstallDir = Join-Path $env:LOCALAPPDATA "CodexAppAgent"

$keep = Read-Host "保留账号配置? (Y 保留 / N 删除全部) [Y]"
if ($keep -eq "N" -or $keep -eq "n") {
  Remove-Item $InstallDir -Recurse -Force
  Write-Host "已删除全部文件。"
} else {
  Remove-Item (Join-Path $InstallDir "CodexApp-Agent.exe") -Force
  Write-Host "已卸载程序，保留配置于 $InstallDir。"
}
Write-Host "开机自启已关闭。" -ForegroundColor Green
Read-Host "按回车退出"
