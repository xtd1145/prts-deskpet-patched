; ============================================================
;  PRTS NSIS custom install: after the app files are in place,
;  ask whether to also install DeepSeek Harness (DSH Web 服务),
;  and if yes run the bundled installer script (downloads the
;  dsh CLI via npm, bootstraps the web profile, registers the
;  startup entry and starts the service).
; ============================================================

!macro customInstall
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否安装 DeepSeek Harness？$\r$\n$\r$\n$\r$\nDeepSeek Harness（DSH Web 服务，127.0.0.1:3080）为普瑞赛斯提供 AI 控制能力。$\r$\n安装需要 Node.js（>=22），将自动：$\r$\n  · 通过 npm 下载 dsh CLI$\r$\n  · 初始化 DSH 配置$\r$\n  · 注册开机自启$\r$\n  · 立即启动服务$\r$\n$\r$\n$\r$\n是否现在安装？" \
    IDYES lblInstallDsh
    Goto lblDshDone
  lblInstallDsh:
    DetailPrint "正在安装 DeepSeek Harness…（可能需数分钟，请保持网络畅通）"
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\tools\install-dsh.ps1" -Start'
    Pop $0
    DetailPrint "DeepSeek Harness 安装脚本退出码：$0"
  lblDshDone:
!macroend
