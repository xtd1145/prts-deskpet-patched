#!/bin/bash
# ============================================================
#  DeepSeek Harness installer (macOS / Linux) — called by the
#  macOS PKG postinstall script when the Doctor chose to install DSH.
#
#  1. check Node.js (>= 22)
#  2. npm install -g @deepseek-ai/dsh
#  3. bootstrap the web profile under $DSH_HOME (first `dsh web` run
#     auto-creates ~/.dsh/profiles/web + its dependency tree)
#  4. register a LaunchAgent so `dsh web` starts at login
#  5. optionally start the service right away (-s)
# ============================================================
set -e

STEP() { echo "[DSH] $1"; }
ERR()  { echo "[DSH] 错误：$1" >&2; }

STEP "开始安装 DeepSeek Harness…"

# ── 1. Node.js ──────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  ERR "未检测到 Node.js。请先安装 Node.js（>= 22，https://nodejs.org）后重试。"
  exit 2
fi
VER="$(node --version | sed 's/^v//')"
MAJOR="${VER%%.*}"
if [ "$MAJOR" -lt 22 ]; then
  ERR "Node.js 版本过低（v$VER，需要 >= 22）。"
  exit 2
fi
STEP "Node.js v$VER OK"

# ── 2. npm install -g ───────────────────────────────────────────────────────
STEP "npm 安装 @deepseek-ai/dsh…"
# --unsafe-perm keeps this working even when run as root (pkg postinstall).
npm install -g --unsafe-perm=true "@deepseek-ai/dsh@0.1.0-rc.6"
if [ $? -ne 0 ]; then ERR "npm 安装失败。"; exit 3; fi

# ── 3. bootstrap the web profile ────────────────────────────────────────────
STEP "初始化 DSH 配置（web profile）…"
if ! command -v dsh >/dev/null 2>&1; then
  ERR "dsh 命令未出现在 PATH 上。"
  exit 3
fi
dsh --profile web --dump-config >/dev/null 2>&1 || true
STEP "web profile 就绪（${DSH_HOME:-$HOME/.dsh}/profiles/web）"

# ── 4. LaunchAgent (login start) ────────────────────────────────────────────
STEP "注册开机自启（LaunchAgent）…"
LAUNCHD="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCHD"
cat > "$LAUNCHD/local.prts.dsh.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.prts.dsh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>dsh web</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
PLIST
launchctl load "$LAUNCHD/local.prts.dsh.plist" 2>/dev/null || true
STEP "LaunchAgent 已注册：$LAUNCHD/local.prts.dsh.plist"

# ── 5. optional immediate start ─────────────────────────────────────────────
if [ "$1" = "-s" ]; then
  STEP "启动 DSH 服务…"
  nohup dsh web >/dev/null 2>&1 &
fi

STEP "DeepSeek Harness 安装完成。"
exit 0
