# ============================================================
#  DeepSeek Harness installer (Windows) — called by the PRTS NSIS
#  installer when the Doctor chose to install DSH, and by the app's
#  DSH panel "唤醒" fallback path.
#
#  What it does:
#    1. check Node.js (>= 22)
#    2. npm install -g @deepseek-ai/dsh (the dsh CLI)
#    3. bootstrap the web profile under $DSH_HOME (first `dsh web` run
#       auto-creates ~/.dsh/profiles/web + its dependency tree)
#    4. register a startup entry (HKCU Run -> a launcher that starts
#       `dsh web`), so the service is there at login
#    5. optionally start the service right away (-Start)
# ============================================================
param(
  [string]$DSHHome = "",
  [switch]$Start,
  [switch]$SkipStartup
)
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[DSH] $msg" -ForegroundColor Cyan }
function Write-Err($msg) { Write-Host "[DSH] 错误：$msg" -ForegroundColor Red }

Write-Step "开始安装 DeepSeek Harness…"

# ── 1. Node.js ──────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Err "未检测到 Node.js。请先安装 Node.js（>= 22，https://nodejs.org）后重试。"
  exit 2
}
try {
  $ver = (node --version) -replace '^v', ''
  $parts = $ver -split '\.'
  $ok = [int]$parts[0] -gt 22 -or ([int]$parts[0] -eq 22)
  if (-not $ok) { Write-Err "Node.js 版本过低（v$ver，需要 >= 22）。"; exit 2 }
  Write-Step "Node.js v$ver OK"
} catch {
  Write-Err "无法读取 Node.js 版本：$($_.Exception.Message)"; exit 2
}

# ── 2. npm install -g the dsh CLI ──────────────────────────────────────────
Write-Step "npm 安装 @deepseek-ai/dsh…"
$prevHome = $env:DSH_HOME
if ($DSHHome) { $env:DSH_HOME = $DSHHome }
try {
  # cmd /c 2>&1: native stderr would otherwise trip PS5.1's ErrorActionPreference
  & cmd /c "npm install -g @deepseek-ai/dsh@0.1.0-rc.6 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Err "npm 安装失败（exit $LASTEXITCODE）。"; exit 3 }
} finally {
  if ($prevHome) { $env:DSH_HOME = $prevHome }
}

# ── 3. bootstrap the web profile ───────────────────────────────────────────
Write-Step "初始化 DSH 配置（web profile）…"
$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dshCmd) {
  Write-Err "dsh 命令未出现在 PATH 上（npm 全局 bin 缺失）。"; exit 3
}
try {
  if ($DSHHome) { $env:DSH_HOME = $DSHHome }
  & cmd /c "dsh --profile web --dump-config >nul 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Err "web profile 初始化失败（exit $LASTEXITCODE）。"; exit 4 }
  Write-Step "web profile 就绪（$($env:DSH_HOME)\profiles\web）"
} catch {
  Write-Err "profile 初始化异常：$($_.Exception.Message)"; exit 4
} finally {
  if ($prevHome) { $env:DSH_HOME = $prevHome }
}

# ── 4. startup entry (HKCU Run -> launcher) ────────────────────────────────
if ($SkipStartup) {
  Write-Step "跳过开机自启注册（-SkipStartup）"
} else {
  Write-Step "注册开机自启…"
  $launcherDir = Join-Path $env:APPDATA "PRTS-dsh"
  New-Item -ItemType Directory -Path $launcherDir -Force | Out-Null
  $launcher = Join-Path $launcherDir "start-dsh.cmd"
  $scriptText = "@echo off`r`n"
  $scriptText += "where dsh >nul 2>&1 || exit /b 1`r`n"
  $scriptText += "start `"DSH Web Server`" /min cmd /c `"dsh web`"`r`n"
  Set-Content -Path $launcher -Value $scriptText -Encoding ASCII
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  if (-not (Test-Path $runKey)) { New-Item -Path $runKey -Force | Out-Null }
  Set-ItemProperty -Path $runKey -Name "dsh-harness" -Value "`"$launcher`"" -Type String -Force
  Write-Step "开机自启已注册：$launcher"
}

# ── 5. optional immediate start ─────────────────────────────────────────────
if ($Start) {
  Write-Step "启动 DSH 服务…"
  Start-Process -FilePath $launcher -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

Write-Step "DeepSeek Harness 安装完成。"
exit 0
