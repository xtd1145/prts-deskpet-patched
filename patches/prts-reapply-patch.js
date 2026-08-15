// Re-apply the PRTS feature patches (auto-launch + DSH control plugin) to a
// (possibly updated) app.asar.
// Usage: node prts-reapply-patch.js [path-to-app.asar] [--install]
// Default asar: C:\Users\bihaojun\AppData\Local\Programs\PRTS\resources\app.asar
// With --install: backs up the current asar (app.asar.pre-patch) and installs.
//
// Two kinds of changes:
//  - anchored string edits on src/main/main.js, src/main/settings.js,
//    src/main/preload.js (each must match exactly once in the fresh source;
//    already-present edits are skipped);
//  - three NEW files copied verbatim from the prts-full working tree
//    (src/main/dsh-control.js, src/renderer/dsh-control.html,
//    src/renderer/dsh-control.js) — they do not exist upstream.
// If an anchor no longer matches (upstream drift), the script reports which
// edit failed and leaves the asar untouched.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TOOLS = __dirname;
const SRC_TREE = path.join(TOOLS, 'prts-full');
const DEFAULT_ASAR = 'C:/Users/bihaojun/AppData/Local/Programs/PRTS/resources/app.asar';
const asarPath = path.resolve(process.argv[2] || DEFAULT_ASAR);
const install = process.argv.includes('--install');

const D = fs.readFileSync(asarPath);
const S = D.readUInt32LE(4), jsonLen = D.readUInt32LE(12);
const tree = JSON.parse(D.slice(16, 16 + jsonLen).toString('utf8'));
const dataStart = 8 + S;
function findOffsets(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.files) findOffsets(child, rel, out);
    else out[rel] = { off: Number(child.offset), size: child.size };
  }
}
const offs = {};
findOffsets(tree, '', offs);

function extractFile(rel) {
  const o = offs[rel];
  if (!o) throw new Error(`file not in asar: ${rel}`);
  return D.slice(dataStart + o.off, dataStart + o.off + o.size);
}

// ── anchored edits (LF anchors; sources are CRLF, normalized before matching) ──
const EDITS = [
  // ══ feature 1: 开机自启动 ══
  ['src/main/settings.js',
    '  desktopPetScale: 1.0,\n  desktopPetPosition: null,\n  popoverSize: { width: 380, height: 560 },',
    '  desktopPetScale: 1.0,\n  desktopPetPosition: null,\n  // Start with Windows at login (writes the HKCU Run key via\n  // app.setLoginItemSettings; the tray checkbox owns this setting).\n  autoLaunch: false,\n  popoverSize: { width: 380, height: 560 },']
  ,
  ['src/main/main.js',
    '    desktopPet: "闲置时显示桌宠",\n    showDesktopPet: "立即显示桌宠",\n    desktopPetSize: "桌宠尺寸",',
    '    desktopPet: "闲置时显示桌宠",\n    showDesktopPet: "立即显示桌宠",\n    desktopPetSize: "桌宠尺寸",\n    autoLaunch: "开机自启动",']
  ,
  ['src/main/main.js',
    '    desktopPet: "Desktop pet while idle",\n    showDesktopPet: "Show desktop pet now",\n    desktopPetSize: "Desktop pet size",',
    '    desktopPet: "Desktop pet while idle",\n    showDesktopPet: "Show desktop pet now",\n    desktopPetSize: "Desktop pet size",\n    autoLaunch: "Launch at login",']
  ,
  ['src/main/main.js',
    '    {\n      label: mt("openChat"),\n      click: () => {\n        if (!popover) createPopover();\n        if (!popover.isVisible()) {\n          positionPopover();\n          popover.show();\n          popover.focus();\n        }\n      }\n    },\n    { type: "separator" },',
    '    {\n      label: mt("openChat"),\n      click: () => {\n        if (!popover) createPopover();\n        if (!popover.isVisible()) {\n          positionPopover();\n          popover.show();\n          popover.focus();\n        }\n      }\n    },\n    {\n      label: mt("autoLaunch"),\n      type: "checkbox",\n      checked: all.autoLaunch === true,\n      click: (item) => {\n        settings.set({ autoLaunch: item.checked });\n        applyAutoLaunch();\n      }\n    },\n    { type: "separator" },']
  ,
  ['src/main/main.js',
    'function buildContextMenu() {',
    '// ============================================================\n//  Auto-launch at login — the "开机自启动" tray checkbox owns the\n//  setting; on Windows app.setLoginItemSettings writes the HKCU\n//  \\Software\\Microsoft\\Windows\\CurrentVersion\\Run entry (removed\n//  again when disabled). Idempotent, safe to call at boot and on\n//  every toggle.\n// ============================================================\nfunction applyAutoLaunch() {\n  try {\n    app.setLoginItemSettings({\n      openAtLogin: settings.get("autoLaunch") === true,\n      path: process.execPath\n    });\n  } catch (error) {\n    console.warn("main: failed to apply auto-launch setting", error);\n  }\n}\n\nfunction buildContextMenu() {']
  ,
  ['src/main/main.js',
    '  settings.init();\n  applyThemeSource();',
    '  settings.init();\n  applyThemeSource();\n  applyAutoLaunch();']
  ,
  // ══ feature 2: DSH control plugin ══
  ['src/main/settings.js',
    '  autoLaunch: false,\n  popoverSize: { width: 380, height: 560 },',
    '  autoLaunch: false,\n  // DeepSeek Harness integration: start the web service (127.0.0.1:3080)\n  // together with PRTS. dshNodePath/dshBinPath/dshArgs are optional overrides\n  // for machines where node or the dsh bundle lives elsewhere.\n  dshAutoStart: false,\n  dshNodePath: "",\n  dshBinPath: "",\n  dshArgs: "",\n  popoverSize: { width: 380, height: 560 },']
  ,
  ['src/main/main.js',
    'const priestessProvider = require("./priestess-provider");\nconst { spawnCli } = require("./cli-spawn");',
    'const priestessProvider = require("./priestess-provider");\nconst dshControl = require("./dsh-control");\nconst { spawnCli } = require("./cli-spawn");']
  ,
  ['src/main/main.js',
    'let priestessSettingsWindow = null;\nlet personaNotesWindow = null;\nlet creditsWindow = null;',
    'let priestessSettingsWindow = null;\nlet personaNotesWindow = null;\nlet creditsWindow = null;\n// DeepSeek Harness control window + cached service status (refreshed on an\n// interval and on demand; the tray and the control panel read the cache).\nlet dshControlWindow = null;\nlet dshStatusCache = { running: false, sessions: 0, error: null, port: dshControl.DSH_PORT };\nlet dshStatusTimer = null;']
  ,
  ['src/main/main.js',
    '  } catch (error) {\n    console.warn("main: failed to apply auto-launch setting", error);\n  }\n}\n\nfunction buildContextMenu() {',
    '  } catch (error) {\n    console.warn("main: failed to apply auto-launch setting", error);\n  }\n}\n\n// ============================================================\n//  DeepSeek Harness (DSH) — start/stop the web service on\n//  127.0.0.1:3080 and control its sessions (list / send / steer /\n//  cancel) through the web API. The tray owns quick actions; the\n//  DSH 控制台 window owns the full control surface.\n// ============================================================\nasync function refreshDshStatus() {\n  try {\n    dshStatusCache = await dshControl.status();\n  } catch (error) {\n    dshStatusCache = { running: false, sessions: 0, error: error.message, port: dshControl.DSH_PORT };\n  }\n  return dshStatusCache;\n}\n\nasync function startDshService() {\n  const result = await dshControl.start({\n    settings,\n    logFile: path.join(app.getPath("userData"), "dsh-service.log")\n  });\n  await refreshDshStatus();\n  return { ...result, status: dshStatusCache };\n}\n\nasync function stopDshService() {\n  const result = await dshControl.stop();\n  await refreshDshStatus();\n  return { ...result, status: dshStatusCache };\n}\n\nfunction openDshControl() {\n  if (dshControlWindow && !dshControlWindow.isDestroyed()) {\n    dshControlWindow.show();\n    dshControlWindow.focus();\n    return;\n  }\n  dshControlWindow = new BrowserWindow({\n    width: 560,\n    height: 640,\n    resizable: false,\n    minimizable: false,\n    maximizable: false,\n    fullscreenable: false,\n    show: false,\n    title: "PRTS · DSH 控制台",\n    backgroundColor: nativeTheme.shouldUseDarkColors ? "#11151a" : "#e9edf2",\n    webPreferences: {\n      preload: path.join(__dirname, "preload.js"),\n      contextIsolation: true,\n      nodeIntegration: false\n    }\n  });\n  dshControlWindow.setMenuBarVisibility?.(false);\n  hardenWebContents(dshControlWindow.webContents);\n  dshControlWindow.loadFile(path.join(__dirname, "..", "renderer", "dsh-control.html"));\n  dshControlWindow.once("ready-to-show", () => {\n    dshControlWindow?.show();\n    dshControlWindow?.focus();\n  });\n  dshControlWindow.on("closed", () => {\n    dshControlWindow = null;\n  });\n}\n\nfunction buildContextMenu() {']
  ,
  ['src/main/main.js',
    '        { type: "separator" },\n        { label: mt("sizeScrollHint"), enabled: false }\n      ]\n    },',
    '        { type: "separator" },\n        { label: mt("sizeScrollHint"), enabled: false }\n      ]\n    },\n    { type: "separator" },\n    {\n      label: mt("dshSection"),\n      enabled: false\n    },\n    {\n      label: dshStatusCache.running\n        ? mt("dshStatusRunning", dshStatusCache.pid ? ` (PID ${dshStatusCache.pid})` : "")\n        : mt("dshStatusStopped"),\n      enabled: false\n    },\n    {\n      label: dshStatusCache.running ? mt("dshStop") : mt("dshStart"),\n      click: () => {\n        // The menu label was built from the same cache this reads, so the\n        // action always matches what the user just saw.\n        if (dshStatusCache.running) stopDshService();\n        else startDshService();\n      }\n    },\n    {\n      label: mt("dshOpenPanel"),\n      enabled: dshStatusCache.running,\n      click: () => shell.openExternal("http://127.0.0.1:3080")\n    },\n    {\n      label: mt("dshOpenControl"),\n      click: () => openDshControl()\n    },\n    {\n      label: mt("dshAutoStart"),\n      type: "checkbox",\n      checked: all.dshAutoStart === true,\n      click: (item) => settings.set({ dshAutoStart: item.checked })\n    },']
  ,
  ['src/main/main.js',
    '    autoLaunch: "开机自启动",',
    '    autoLaunch: "开机自启动",\n    dshSection: "DeepSeek Harness",\n    dshStatusRunning: (pid) => `状态：运行中${pid || ""}`,\n    dshStatusStopped: "状态：未运行",\n    dshStart: "启动 DSH 服务",\n    dshStop: "停止 DSH 服务",\n    dshOpenPanel: "打开 DSH 面板",\n    dshOpenControl: "DSH 控制台…",\n    dshAutoStart: "随 PRTS 启动 DSH 服务",']
  ,
  ['src/main/main.js',
    '    autoLaunch: "Launch at login",',
    '    autoLaunch: "Launch at login",\n    dshSection: "DeepSeek Harness",\n    dshStatusRunning: (pid) => `Status: running${pid || ""}`,\n    dshStatusStopped: "Status: stopped",\n    dshStart: "Start DSH service",\n    dshStop: "Stop DSH service",\n    dshOpenPanel: "Open DSH panel",\n    dshOpenControl: "DSH console…",\n    dshAutoStart: "Start DSH with PRTS",']
  ,
  ['src/main/main.js',
    '  settings.init();\n  applyThemeSource();\n  applyAutoLaunch();',
    '  settings.init();\n  applyThemeSource();\n  applyAutoLaunch();\n  // DSH service: start with PRTS when enabled, and keep the tray/panel status\n  // cache warm. The service itself is independent of PRTS — quitting PRTS\n  // leaves it running (the 停止 DSH 服务 action owns its lifetime).\n  refreshDshStatus();\n  dshStatusTimer = setInterval(() => {\n    refreshDshStatus();\n  }, 5000);\n  if (settings.get("dshAutoStart") === true) {\n    startDshService();\n  }']
  ,
  ['src/main/main.js',
    'ipcMain.handle("desktop-pet:scale", (_, factor) => scaleDesktopPetBy(factor));',
    'ipcMain.handle("desktop-pet:scale", (_, factor) => scaleDesktopPetBy(factor));\n\n// ── DeepSeek Harness control ────────────────────────────────────────────────\nipcMain.handle("dsh:get-status", async () => refreshDshStatus());\n\nipcMain.handle("dsh:start", () => startDshService());\n\nipcMain.handle("dsh:stop", () => stopDshService());\n\nipcMain.handle("dsh:list-sessions", () => dshControl.listSessions());\n\nipcMain.handle("dsh:send", (_, { sessionId, text, mode }) =>\n  dshControl.send(sessionId, text, mode)\n);\n\nipcMain.handle("dsh:cancel", (_, { sessionId }) => dshControl.cancel(sessionId));\n\nipcMain.handle("dsh:get-auto-start", () => settings.get("dshAutoStart") === true);\n\nipcMain.handle("dsh:set-auto-start", (_, value) => {\n  settings.set({ dshAutoStart: Boolean(value) });\n  return settings.get("dshAutoStart") === true;\n});\n\nipcMain.handle("dsh:open-panel", () => {\n  shell.openExternal("http://127.0.0.1:3080");\n});']
  ,
  ['src/main/preload.js',
    'contextBridge.exposeInMainWorld("chatApi", {',
    'contextBridge.exposeInMainWorld("dshApi", {\n  getStatus: () => ipcRenderer.invoke("dsh:get-status"),\n  start: () => ipcRenderer.invoke("dsh:start"),\n  stop: () => ipcRenderer.invoke("dsh:stop"),\n  listSessions: () => ipcRenderer.invoke("dsh:list-sessions"),\n  send: (sessionId, text, mode) => ipcRenderer.invoke("dsh:send", { sessionId, text, mode }),\n  cancel: (sessionId) => ipcRenderer.invoke("dsh:cancel", { sessionId }),\n  getAutoStart: () => ipcRenderer.invoke("dsh:get-auto-start"),\n  setAutoStart: (value) => ipcRenderer.invoke("dsh:set-auto-start", value),\n  openPanel: () => ipcRenderer.invoke("dsh:open-panel")\n});\n\ncontextBridge.exposeInMainWorld("chatApi", {']
  ,
  // ══ feature 3: popover mode switch (对话 / 控制 · DSH) ══
  ['src/renderer/index.html',
    '</header>\n\n    <section class="stage" id="petStage">',
    '</header>\n\n    <div class="mode-tabs" id="modeTabs" role="tablist" aria-label="Mode">\n      <button type="button" id="modeChat" class="mode-tab active" role="tab" aria-selected="true">对话</button>\n      <button type="button" id="modeControl" class="mode-tab" role="tab" aria-selected="false">控制 · DSH</button>\n    </div>\n\n    <section class="stage" id="petStage">']
  ,
  ['src/renderer/index.html',
    '    </div>\n\n    <footer class="composer">',
    '    </div>\n\n    <section class="dsh-control-view" id="dshControlView" hidden>\n      <div class="dshc-card">\n        <div class="dshc-status-line">\n          <span class="dshc-dot" id="dshcStatusDot"></span>\n          <span id="dshcStatusText">检测 DSH 服务…</span>\n        </div>\n        <div class="dshc-row">\n          <button type="button" id="dshcStartBtn" class="ghost">唤醒 DSH</button>\n          <button type="button" id="dshcStopBtn" class="ghost" disabled>停止服务</button>\n          <button type="button" id="dshcOpenBtn" class="ghost" disabled>打开面板</button>\n          <button type="button" id="dshcRefreshBtn" class="ghost">刷新</button>\n        </div>\n        <div class="dshc-toggle-row">\n          <input type="checkbox" id="dshcAutoStart" />\n          <label for="dshcAutoStart">随 PRTS 启动 DSH</label>\n        </div>\n      </div>\n      <div class="dshc-card">\n        <div class="dshc-label">会话（点击选择发送目标）</div>\n        <div class="dshc-sessions" id="dshcSessions">\n          <div class="dshc-empty" id="dshcSessionsHint">（暂无会话 / 服务未运行）</div>\n        </div>\n        <input type="text" id="dshcMsg" class="dshc-input" placeholder="向选中的 agent 发送消息…" spellcheck="false" />\n        <div class="dshc-row">\n          <button type="button" id="dshcSendBtn" class="ghost dshc-primary">发送</button>\n          <button type="button" id="dshcSteerBtn" class="ghost">打断</button>\n          <button type="button" id="dshcCancelBtn" class="ghost dshc-danger" disabled>停止回合</button>\n        </div>\n        <div id="dshcStatusLine" class="dshc-status-line dshc-small"></div>\n      </div>\n    </section>\n\n    <footer class="composer">']
  ,
  ['src/renderer/index.html',
    '    <script src="./renderer.js"></script>\n  </body>',
    '    <script src="./renderer.js"></script>\n    <script src="./dsh-control-inline.js"></script>\n  </body>']
  ,
  ['src/renderer/styles.css',
    '.msg-preview-btn.active {\n  background: var(--her-soft);\n  border-color: var(--her-edge);\n}',
    '.msg-preview-btn.active {\n  background: var(--her-soft);\n  border-color: var(--her-edge);\n}\n\n/* ── mode tabs: 对话 / 控制 · DSH ────────────────────────────────────────── */\n.mode-tabs {\n  display: flex;\n  gap: 2px;\n  padding: 4px 10px 2px;\n  background: var(--panel);\n  border-bottom: 1px solid var(--border);\n}\n.mode-tab {\n  flex: 1;\n  padding: 4px 0 5px;\n  border: none;\n  background: transparent;\n  color: var(--muted);\n  font: inherit;\n  font-size: 12px;\n  font-weight: 600;\n  cursor: pointer;\n  border-radius: 6px 6px 0 0;\n  transition: background 120ms ease, color 120ms ease;\n}\n.mode-tab:hover {\n  background: var(--panel-2);\n}\n.mode-tab.active {\n  color: var(--text);\n  background: var(--panel-2);\n  box-shadow: inset 0 -2px 0 var(--her);\n}\n\n/* ── embedded DSH control view (popover) ─────────────────────────────────── */\n.dsh-control-view {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n  padding: 10px 12px 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  background: var(--chat-bg);\n}\n.dshc-card {\n  border: 1px solid var(--border);\n  border-radius: 10px;\n  background: var(--panel);\n  padding: 9px 11px;\n}\n.dshc-status-line {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-weight: 600;\n  color: var(--text);\n  font-size: 13px;\n  margin-bottom: 8px;\n}\n.dshc-status-line.dshc-small {\n  font-size: 12px;\n  font-weight: 400;\n  color: var(--muted);\n  margin: 8px 0 0;\n  min-height: 1.3em;\n  user-select: text;\n  overflow-wrap: anywhere;\n}\n.dshc-status-line.dshc-small.err { color: var(--danger); }\n.dshc-dot {\n  width: 9px;\n  height: 9px;\n  border-radius: 50%;\n  flex: none;\n  background: var(--muted);\n  opacity: 0.5;\n}\n.dshc-dot.on {\n  background: var(--her);\n  opacity: 1;\n  box-shadow: 0 0 6px var(--her);\n}\n.dshc-row {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n}\n.dshc-row button.ghost {\n  flex: 1;\n  min-width: 72px;\n  padding: 5px 8px;\n}\n.dshc-primary {\n  border-color: var(--her-edge) !important;\n  color: var(--text) !important;\n  font-weight: 600;\n}\n.dshc-danger {\n  border-color: color-mix(in srgb, var(--danger) 55%, transparent) !important;\n  color: var(--danger) !important;\n}\n.dshc-toggle-row {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  margin-top: 9px;\n  font-size: 12px;\n  color: var(--muted);\n}\n.dshc-label {\n  font-weight: 600;\n  font-size: 12px;\n  color: var(--muted);\n  margin-bottom: 5px;\n}\n.dshc-sessions {\n  max-height: 120px;\n  overflow-y: auto;\n  border: 1px solid var(--border);\n  border-radius: 8px;\n  background: var(--panel-2);\n  margin-bottom: 8px;\n}\n.dshc-empty {\n  padding: 9px;\n  font-size: 12px;\n  color: var(--muted);\n  text-align: center;\n}\n.dshc-session-row {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  padding: 5px 8px;\n  cursor: pointer;\n  border-bottom: 1px solid var(--border);\n  font-size: 12px;\n}\n.dshc-session-row:last-child { border-bottom: none; }\n.dshc-session-row.selected { background: var(--her-soft); }\n.dshc-session-row .sdot {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  flex: none;\n  background: var(--muted);\n  opacity: 0.5;\n}\n.dshc-session-row .sdot.on { background: var(--her); opacity: 1; }\n.dshc-session-row .sid {\n  font-family: ui-monospace, Consolas, monospace;\n  font-size: 10px;\n  color: var(--muted);\n}\n.dshc-session-row .smeta {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  color: var(--text);\n}\n.dshc-input {\n  width: 100%;\n  padding: 6px 8px;\n  border: 1px solid var(--border-strong);\n  border-radius: 8px;\n  background: var(--panel-2);\n  color: var(--text);\n  font: inherit;\n  font-size: 12px;\n  outline: none;\n  margin-bottom: 8px;\n}\n.dshc-input:focus { border-color: var(--her-edge); }\n.dshc-input::placeholder { color: var(--muted); }']
  ,
  ['src/renderer/styles.css',
    '/* ── mode tabs: 对话 / 控制 · DSH ────────────────────────────────────────── */\n.mode-tabs {',
    '/* ── mode tabs: 对话 / 控制 · DSH ────────────────────────────────────────── */\n/* The hidden attribute must beat any author display rule: the control view\n   and the chat surfaces all set display:flex, which would otherwise keep a\n   [hidden] element on screen and collapse the chat area to zero height. */\n[hidden] {\n  display: none !important;\n}\n.mode-tabs {']
  ,
  // ══ feature 4: fix built-in backend HTTP 404 (Anthropic base / empty model) ══
  ['src/main/priestess-provider.js',
    '// Accept base URLs with or without /v1 (or a full /chat/completions path).\nfunction chatCompletionsUrl(baseUrl) {\n  const base = String(baseUrl || "").trim().replace(/\\/+$/, "");\n  if (!base) return null;\n  if (base.endsWith("/chat/completions")) return base;\n  if (base.endsWith("/v1")) return `${base}/chat/completions`;\n  return `${base}/v1/chat/completions`;\n}',
    '// Accept base URLs with or without /v1 (or a full /chat/completions path).\n// A trailing /anthropic (the Anthropic-format base DeepSeek documents for CLIs)\n// is OpenAI-incompatible — the gateway serves the OpenAI surface from the\n// root, so normalize it away before appending /v1/chat/completions.\nfunction chatCompletionsUrl(baseUrl) {\n  let base = String(baseUrl || "").trim().replace(/\\/+$/, "");\n  if (!base) return null;\n  if (base.endsWith("/chat/completions")) return base;\n  if (base.endsWith("/anthropic")) base = base.replace(/\\/anthropic$/, "");\n  if (base.endsWith("/v1")) return `${base}/chat/completions`;\n  return `${base}/v1/chat/completions`;\n}']
  ,
  ['src/main/priestess-provider.js',
    '    .replace(/\\/+$/, "")\n    .replace(/\\/chat\\/completions$/, "")\n    .replace(/\\/v1$/, "");',
    '    .replace(/\\/+$/, "")\n    .replace(/\\/chat\\/completions$/, "")\n    .replace(/\\/anthropic$/, "")\n    .replace(/\\/v1$/, "");']
  ,
  // ══ feature 5: pet window behavior (pin to foreground + mouse click-through) ══
  ['src/main/settings.js',
    '  desktopPetScale: 1.0,\n  desktopPetPosition: null,\n  // Start with Windows at login (writes the HKCU Run key via',
    '  desktopPetScale: 1.0,\n  desktopPetPosition: null,\n  // Desktop pet window behavior: pinned = always on top (stays above normal\n  // windows); click-through = ignore mouse events (clicks pass to whatever is\n  // underneath, hover moves still forwarded for cursor feedback).\n  desktopPetPinned: true,\n  desktopPetClickThrough: false,\n  // Start with Windows at login (writes the HKCU Run key via']
  ,
  ['src/main/main.js',
    '  hardenWebContents(desktopPet.webContents);\n  desktopPet.loadFile(path.join(__dirname, "..", "renderer", "desktop-pet.html"));',
    '  hardenWebContents(desktopPet.webContents);\n  // Window behavior plugin: pinned (always-on-top at the screen-saver level so\n  // she stays above normal windows) and click-through (mouse events pass to\n  // whatever is underneath). Both are tray-toggled, persisted settings.\n  desktopPet.setAlwaysOnTop(settings.get("desktopPetPinned") !== false, "screen-saver");\n  desktopPet.setIgnoreMouseEvents(settings.get("desktopPetClickThrough") === true, { forward: true });\n  desktopPet.loadFile(path.join(__dirname, "..", "renderer", "desktop-pet.html"));']
  ,
  ['src/main/main.js',
    'function hideDesktopPet() {\n  clearTimeout(desktopPetTimer);\n  desktopPetTimer = null;\n  desktopPet?.hide();\n}',
    'function hideDesktopPet() {\n  clearTimeout(desktopPetTimer);\n  desktopPetTimer = null;\n  desktopPet?.hide();\n}\n\n// Tray toggles for the pet window behavior: persist + apply immediately.\nfunction setDesktopPetPinned(pinned) {\n  settings.set({ desktopPetPinned: Boolean(pinned) });\n  if (desktopPet && !desktopPet.isDestroyed()) {\n    desktopPet.setAlwaysOnTop(Boolean(pinned), "screen-saver");\n  }\n}\n\nfunction setDesktopPetClickThrough(enable) {\n  settings.set({ desktopPetClickThrough: Boolean(enable) });\n  if (desktopPet && !desktopPet.isDestroyed()) {\n    desktopPet.setIgnoreMouseEvents(Boolean(enable), { forward: true });\n  }\n}']
  ,
  ['src/main/main.js',
    '        { type: "separator" },\n        { label: mt("sizeScrollHint"), enabled: false }\n      ]\n    },\n    { type: "separator" },\n    {\n      label: mt("dshSection"),',
    '        { type: "separator" },\n        { label: mt("sizeScrollHint"), enabled: false }\n      ]\n    },\n    {\n      label: mt("desktopPetPinned"),\n      type: "checkbox",\n      checked: all.desktopPetPinned !== false,\n      click: (item) => setDesktopPetPinned(item.checked)\n    },\n    {\n      label: mt("desktopPetClickThrough"),\n      type: "checkbox",\n      checked: all.desktopPetClickThrough === true,\n      click: (item) => setDesktopPetClickThrough(item.checked)\n    },\n    { type: "separator" },\n    {\n      label: mt("dshSection"),']
  ,
  ['src/main/main.js',
    '    desktopPetSize: "桌宠尺寸",',
    '    desktopPetSize: "桌宠尺寸",\n    desktopPetPinned: "固定在前台",\n    desktopPetClickThrough: "鼠标穿透",']
  ,
  ['src/main/main.js',
    '    desktopPetSize: "Desktop pet size",',
    '    desktopPetSize: "Desktop pet size",\n    desktopPetPinned: "Pin to foreground",\n    desktopPetClickThrough: "Mouse click-through",']
  ,
  // ══ feature 6: pet-side click-through toggle (icon button on the pet) ══
  ['src/renderer/desktop-pet.html',
    '    <canvas id="petCanvas" width="190" height="230" aria-label="Open PRTS chat"></canvas>\n    <script src="./desktop-pet.js"></script>',
    '    <canvas id="petCanvas" width="190" height="230" aria-label="Open PRTS chat"></canvas>\n    <button type="button" id="clickThroughToggle" class="ct-toggle" aria-label="鼠标穿透开关">\n      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\n        <path d="M4 4l7.5 16 2-7.5L21 10.5z" />\n      </svg>\n    </button>\n    <script src="./desktop-pet.js"></script>']
  ,
  ['src/renderer/desktop-pet.css',
    'body.is-dragging #petCanvas {\n  cursor: grabbing;\n}',
    'body.is-dragging #petCanvas {\n  cursor: grabbing;\n}\n\n/* Mouse click-through toggle — icon-only button pinned to the pet\'s top-right\n   corner. Active state (click-through ON) shows a highlighted ring; the text\n   description lives in the tray menu, not here. */\n.ct-toggle {\n  position: fixed;\n  top: 6px;\n  right: 6px;\n  width: 24px;\n  height: 24px;\n  padding: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 50%;\n  border: 1px solid rgba(255, 255, 255, 0.35);\n  background: rgba(0, 0, 0, 0.30);\n  color: rgba(255, 255, 255, 0.85);\n  cursor: pointer;\n  opacity: 0.55;\n  transition: opacity 120ms ease, background 120ms ease, border-color 120ms ease, color 120ms ease;\n  z-index: 2;\n}\n.ct-toggle:hover {\n  opacity: 1;\n  background: rgba(0, 0, 0, 0.45);\n}\n.ct-toggle.active {\n  opacity: 1;\n  border-color: var(--her, #7bdff2);\n  color: var(--her, #7bdff2);\n  background: rgba(123, 223, 242, 0.18);\n  box-shadow: 0 0 6px rgba(123, 223, 242, 0.5);\n}']
  ,
  ['src/renderer/desktop-pet.js',
    '}).then(() => {\n  scheduleBlink();\n  requestAnimationFrame(draw);\n}).catch((error) => console.error("Failed to load frames:", error));',
    '}).then(() => {\n  scheduleBlink();\n  requestAnimationFrame(draw);\n}).catch((error) => console.error("Failed to load frames:", error));\n\n// ── mouse click-through toggle (icon-only, top-right corner) ───────────────\n// When click-through is ON the whole window ignores mouse events, so the\n// button stays reachable through the classic interactive-region pattern:\n// the window forwards mousemove (forward:true), the page watches the cursor,\n// and while it is over the button rect we momentarily re-enable mouse events\n// so the button itself is clickable again. Text description lives in the\n// tray menu; here it is a pure icon.\nconst clickThroughToggle = document.getElementById("clickThroughToggle");\nlet clickThrough = false;\nlet rectInteractive = false;\nlet lastMouse = { x: 0, y: 0 };\n\nfunction isOverToggle(x, y) {\n  const r = clickThroughToggle.getBoundingClientRect();\n  const pad = 6;\n  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;\n}\n\nfunction syncToggle() {\n  clickThroughToggle.classList.toggle("active", clickThrough);\n  if (!clickThrough) {\n    // Fully interactive again — undo any transient region state.\n    rectInteractive = false;\n    window.petApi?.setIgnoreMouseEvents?.(false)?.catch?.(() => {});\n  }\n}\n\nfunction applyRectState(x, y) {\n  if (!clickThrough) return;\n  const over = isOverToggle(x, y);\n  if (over !== rectInteractive) {\n    rectInteractive = over;\n    // ignore=true -> click-through; ignore=false -> button region clickable.\n    window.petApi?.setIgnoreMouseEvents?.(!over)?.catch?.(() => {});\n  }\n}\n\nwindow.addEventListener("mousemove", (event) => {\n  lastMouse = { x: event.clientX, y: event.clientY };\n  applyRectState(lastMouse.x, lastMouse.y);\n});\n\nclickThroughToggle.addEventListener("click", () => {\n  const next = !clickThrough;\n  window.petApi?.setClickThrough?.(next)\n    .then((enabled) => {\n      clickThrough = !!enabled;\n      syncToggle();\n      // If we just enabled click-through, immediately (re)establish the\n      // interactive button region so the cursor currently on it stays usable.\n      if (clickThrough) applyRectState(lastMouse.x, lastMouse.y);\n    })\n    .catch((error) => console.error("Failed to toggle click-through:", error));\n});\n\nwindow.petApi?.onClickThroughState?.((enabled) => {\n  clickThrough = !!enabled;\n  syncToggle();\n});\n\n(window.petApi?.getClickThrough?.() ?? Promise.resolve(false))\n  .then((enabled) => {\n    clickThrough = !!enabled;\n    syncToggle();\n  })\n  .catch(() => {});\n']
  ,
  ['src/main/preload.js',
    '  scaleDesktopPet: (factor) => ipcRenderer.invoke("desktop-pet:scale", factor),',
    '  scaleDesktopPet: (factor) => ipcRenderer.invoke("desktop-pet:scale", factor),\n  setClickThrough: (enable) => ipcRenderer.invoke("desktop-pet:click-through", enable),\n  getClickThrough: () => ipcRenderer.invoke("desktop-pet:click-through-get"),\n  // Transient mouse-event ignore state for the interactive-region trick (the\n  // icon button stays clickable while click-through is on).\n  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke("desktop-pet:set-ignore-mouse", ignore),\n  onClickThroughState: onChannel("desktop-pet:click-through-state"),']
  ,
  ['src/main/main.js',
    'ipcMain.handle("desktop-pet:scale", (_, factor) => scaleDesktopPetBy(factor));',
    'ipcMain.handle("desktop-pet:scale", (_, factor) => scaleDesktopPetBy(factor));\n\n// Pet window behavior: click-through toggle (persists) + transient\n// mouse-ignore state used by the pet\'s interactive icon-button region.\nipcMain.handle("desktop-pet:click-through", (_, enable) => {\n  setDesktopPetClickThrough(Boolean(enable));\n  return settings.get("desktopPetClickThrough") === true;\n});\n\nipcMain.handle("desktop-pet:click-through-get", () => settings.get("desktopPetClickThrough") === true);\n\nipcMain.handle("desktop-pet:set-ignore-mouse", (_, ignore) => {\n  if (desktopPet && !desktopPet.isDestroyed()) {\n    desktopPet.setIgnoreMouseEvents(Boolean(ignore), { forward: true });\n  }\n  return Boolean(ignore);\n});']
  ,
  ['src/main/main.js',
    '    if (patch && "outfit" in patch && desktopPet && !desktopPet.isDestroyed()) {\n      desktopPet.webContents.send("settings:state", buildSettingsState());\n    }\n  });',
    '    if (patch && "outfit" in patch && desktopPet && !desktopPet.isDestroyed()) {\n      desktopPet.webContents.send("settings:state", buildSettingsState());\n    }\n    // Keep the pet\'s icon toggle in sync when click-through is flipped from\n    // the tray menu while the pet is already on screen.\n    if (patch && "desktopPetClickThrough" in patch && desktopPet && !desktopPet.isDestroyed()) {\n      desktopPet.webContents.send("desktop-pet:click-through-state", settings.get("desktopPetClickThrough") === true);\n    }\n  });']
  ,
  // ══ feature 7: data directory inheritance (userData pinned) ══
  ['src/main/main.js',
    'const { spawnCli } = require("./cli-spawn");',
    'const { spawnCli } = require("./cli-spawn");\n\n// ── patched build: keep the original data directory ────────────────────────\n// A packaged build derives its userData from the app name; pin it to the\n// original app\'s data folder so existing settings (backend URL / key), the\n// persona notes, memory and conversation history carry straight into this\n// patched version. No-op for the original install (same path).\ntry {\n  app.setPath("userData", path.join(app.getPath("appData"), "claude-code-but-priestess"));\n} catch (error) {\n  console.warn("main: failed to pin userData", error);\n}']
  ,
  // ══ feature 8: auto-update from the patched GitHub repo ══
  ['src/main/updater.js',
    'const REPO_OWNER = "SVAH-X";\nconst REPO_NAME = "claude-code-but-priestess";',
    '// Patched build: updates come from the patched project\'s own GitHub release.\nconst REPO_OWNER = "xtd1145";\nconst REPO_NAME = "prts-deskpet-patched";']
  ,
  // ══ feature 9: 意见反馈 (feedback → GitHub issues) ══
  ['src/main/main.js',
    'const dshControl = require("./dsh-control");',
    'const dshControl = require("./dsh-control");\nconst feedback = require("./feedback");']
  ,
  ['src/main/main.js',
    'let dshStatusTimer = null;',
    'let dshStatusTimer = null;\nlet feedbackWindow = null;']
  ,
  ['src/main/main.js',
    '  dshControlWindow.on("closed", () => {\n    dshControlWindow = null;\n  });\n}',
    '  dshControlWindow.on("closed", () => {\n    dshControlWindow = null;\n  });\n}\n\n// 意见反馈 window: feature request / bug report, submitted to GitHub Issues.\nfunction openFeedbackWindow() {\n  if (feedbackWindow && !feedbackWindow.isDestroyed()) {\n    feedbackWindow.show();\n    feedbackWindow.focus();\n    return;\n  }\n  feedbackWindow = new BrowserWindow({\n    width: 520,\n    height: 560,\n    resizable: false,\n    minimizable: false,\n    maximizable: false,\n    fullscreenable: false,\n    show: false,\n    title: "PRTS · 意见反馈",\n    backgroundColor: nativeTheme.shouldUseDarkColors ? "#11151a" : "#e9edf2",\n    webPreferences: {\n      preload: path.join(__dirname, "preload.js"),\n      contextIsolation: true,\n      nodeIntegration: false\n    }\n  });\n  feedbackWindow.setMenuBarVisibility?.(false);\n  hardenWebContents(feedbackWindow.webContents);\n  feedbackWindow.loadFile(path.join(__dirname, "..", "renderer", "feedback.html"));\n  feedbackWindow.once("ready-to-show", () => {\n    feedbackWindow?.show();\n    feedbackWindow?.focus();\n  });\n  feedbackWindow.on("closed", () => {\n    feedbackWindow = null;\n  });\n}']
  ,
  ['src/main/main.js',
    'ipcMain.handle("dsh:open-panel", () => {\n  shell.openExternal("http://127.0.0.1:3080");\n});',
    'ipcMain.handle("dsh:open-panel", () => {\n  shell.openExternal("http://127.0.0.1:3080");\n});\n\n// ── Feedback ────────────────────────────────────────────────────────────────\nipcMain.handle("feedback:submit", (_, { type, title, body }) =>\n  feedback.submit({\n    type,\n    title,\n    body,\n    onCode: (payload) => {\n      if (feedbackWindow && !feedbackWindow.isDestroyed()) {\n        feedbackWindow.webContents.send("feedback:device-code", payload);\n      }\n    }\n  })\n);\n\nipcMain.handle("feedback:open-prefilled", (_, url) => {\n  if (typeof url === "string" && url.startsWith("https://github.com/")) shell.openExternal(url);\n});']
  ,
  ['src/main/main.js',
    '    {\n      label: mt("dshAutoStart"),\n      type: "checkbox",\n      checked: all.dshAutoStart === true,\n      click: (item) => settings.set({ dshAutoStart: item.checked })\n    },',
    '    {\n      label: mt("dshAutoStart"),\n      type: "checkbox",\n      checked: all.dshAutoStart === true,\n      click: (item) => settings.set({ dshAutoStart: item.checked })\n    },\n    {\n      label: mt("feedbackItem"),\n      click: () => openFeedbackWindow()\n    },']
  ,
  ['src/main/main.js',
    '    dshAutoStart: "随 PRTS 启动 DSH 服务",',
    '    dshAutoStart: "随 PRTS 启动 DSH 服务",\n    feedbackItem: "意见反馈…",']
  ,
  ['src/main/main.js',
    '    dshAutoStart: "Start DSH with PRTS",',
    '    dshAutoStart: "Start DSH with PRTS",\n    feedbackItem: "Feedback…",']
  ,
  ['src/main/preload.js',
    'contextBridge.exposeInMainWorld("chatApi", {',
    'contextBridge.exposeInMainWorld("feedbackApi", {\n  submit: (payload) => ipcRenderer.invoke("feedback:submit", payload),\n  onDeviceCode: onChannel("feedback:device-code"),\n  openPrefilled: (url) => ipcRenderer.invoke("feedback:open-prefilled", url)\n});\n\ncontextBridge.exposeInMainWorld("chatApi", {']
  ,
  // ══ feature 10: credits entry (B站 @普瑞赛斯princess) ══
  ['src/main/main.js',
    '  {\n    name: "十月祈雨",\n    role: { zh: "图像资源增强性修复", en: "Image assets enhancement" },\n    links: [\n      { label: "B站 @十月祈雨", url: "https://space.bilibili.com/129931520" },\n      { label: "GitHub @OctoberPrayRain", url: "https://github.com/OctoberPrayRain" }\n    ]\n  }\n];',
    '  {\n    name: "十月祈雨",\n    role: { zh: "图像资源增强性修复", en: "Image assets enhancement" },\n    links: [\n      { label: "B站 @十月祈雨", url: "https://space.bilibili.com/129931520" },\n      { label: "GitHub @OctoberPrayRain", url: "https://github.com/OctoberPrayRain" }\n    ]\n  },\n  {\n    name: "普瑞赛斯princess",\n    role: { zh: "补丁完整版需求方与测试", en: "Patched build requester & tester" },\n    links: [{ label: "B站 @普瑞赛斯princess" }]\n  }\n];']
  ,
];

// ── new files copied from the working tree ──
const NEW_FILES = [
  'src/main/dsh-control.js',
  'src/main/feedback.js',
  'src/renderer/dsh-control.html',
  'src/renderer/dsh-control.js',
  'src/renderer/dsh-control-inline.js',
  'src/renderer/feedback.html',
  'src/renderer/feedback.js'
];

// Apply the anchored edits in memory.
const patched = new Map();
for (const [rel, from, to] of EDITS) {
  let src;
  if (patched.has(rel)) src = patched.get(rel);
  else { src = extractFile(rel).toString('utf8').replace(/\r\n/g, '\n'); patched.set(rel, src); }
  if (src.includes(to)) { console.log(`skip (already patched): ${rel}`); continue; }
  const count = src.split(from).length - 1;
  if (count !== 1) {
    console.error(`EDIT FAILED (anchor matched ${count} times): ${rel}`);
    process.exit(1);
  }
  patched.set(rel, src.replace(from, to));
  console.log(`applied: ${rel}`);
}

// Rebuild the whole asar from a temp extraction with the patched files
// overlaid and the new files added.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prts-patch-'));
const dump = path.join(TOOLS, 'asar-dump.js');
const packer = path.join(TOOLS, 'asar-pack.js');
execFileSync(process.execPath, [dump, asarPath, tmp], { stdio: 'ignore' });
// Write every anchored edit's result back over the extraction (no hardcoded
// file list — whatever the EDITS table touched lands on disk).
for (const [rel, content] of patched) {
  const dest = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  console.log(`patched: ${rel}`);
}
for (const rel of NEW_FILES) {
  const dest = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(SRC_TREE, rel), dest);
  console.log(`added: ${rel}`);
}
const out = path.join(TOOLS, 'app-repatched.asar');
execFileSync(process.execPath, [packer, tmp, out], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });

if (install) {
  const backup = asarPath + '.pre-patch';
  if (!fs.existsSync(backup)) fs.copyFileSync(asarPath, backup);
  fs.copyFileSync(out, asarPath);
  console.log(`installed -> ${asarPath} (backup at ${backup})`);
} else {
  console.log(`written -> ${out} (dry run; use --install to deploy)`);
}
