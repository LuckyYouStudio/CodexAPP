# Code-sign the agent exe with your code-signing certificate (.pfx).
# You need a code-signing certificate (e.g. from DigiCert/Sectigo) to remove the
# Windows SmartScreen warning. Usage:
#   powershell -ExecutionPolicy Bypass -File sign.ps1 -PfxPath cert.pfx -Password ****
param(
  [Parameter(Mandatory = $true)][string]$PfxPath,
  [string]$Password = "",
  [string]$Exe = "$PSScriptRoot\..\..\dist\CodexApp-Agent.exe",
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)
$ErrorActionPreference = "Stop"

$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { Write-Host "signtool.exe not found - install the Windows 10/11 SDK." -ForegroundColor Red; exit 1 }
if (-not (Test-Path $Exe)) { Write-Host "Exe not found: $Exe  (build it first: node cloud/build-agent.mjs)" -ForegroundColor Red; exit 1 }

Write-Host "Removing any stale signature ..."
& $signtool.FullName remove /s $Exe 2>$null  # SEA exes carry a corrupted base sig; harmless if none
Write-Host "Signing $Exe ..."
& $signtool.FullName sign /f $PfxPath /p $Password /fd SHA256 /tr $TimestampUrl /td SHA256 $Exe
Write-Host "Verifying ..."
& $signtool.FullName verify /pa $Exe
Write-Host "Done. The signed exe no longer triggers SmartScreen (once your cert reputation builds)." -ForegroundColor Green
