// ============================================================
//  快捷启动 (Quick Launch) — launch installed apps from the tray
//  or the management window. Ships with Steam / SakuraCat /
//  哔哩哔哩直播姬 detection; the Doctor can add any app (path +
//  optional args) through the window or by editing the
//  `quickLaunch` array in settings.json.
//
//  Persistence: settings.get("quickLaunch") is an array of
//  { id?, name, path, args? }. On first use (undefined) it is
//  seeded with the three known apps (detected paths, or empty
//  path when the app was not found so the entry stays visible).
// ============================================================

const { shell, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const settings = require("./settings");

const KNOWN_APPS = [
  { id: "steam", name: "Steam", detect: detectSteam },
  { id: "sakura", name: "SakuraCat", detect: detectSakura },
  { id: "livehime", name: "哔哩哔哩直播姬", detect: detectLivehime }
];

function existing(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return "";
}

function regQuery(scope) {
  try {
    const out = execFileSync("reg", ["query", scope], { encoding: "utf8", timeout: 8000 });
    return out;
  } catch {
    return "";
  }
}

function detectSteam() {
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const found = existing([
    path.join(pf86, "Steam", "steam.exe"),
    path.join(pf, "Steam", "steam.exe"),
    "D:\\steam\\steam.exe",
    "E:\\steam\\steam.exe"
  ]);
  if (found) return found;
  const out = regQuery("HKCU\\Software\\Valve\\Steam /v SteamExe");
  const m = out.match(/SteamExe\s+REG_\w+\s+(.+)/);
  return m && fs.existsSync(m[1].trim()) ? m[1].trim() : "";
}

function detectSakura() {
  const local = process.env.LOCALAPPDATA || "C:\\Users\\" + (process.env.USERNAME || "") + "\\AppData\\Local";
  return existing([
    path.join(local, "Programs", "SakuraCat", "SakuraCat.exe"),
    path.join(process.env.APPDATA || "", "SakuraCat", "SakuraCat.exe")
  ]);
}

function detectLivehime() {
  // Versioned install dir: E:\livehime\<version>\livehime.exe — pick the
  // newest version dir.
  const roots = ["E:\\livehime", "D:\\livehime", "C:\\livehime", "C:\\Program Files\\livehime", "C:\\Program Files (x86)\\livehime"];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const dirs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const d of dirs) {
        const exe = path.join(root, d, "livehime.exe");
        if (fs.existsSync(exe)) return exe;
      }
    } catch {
      /* next root */
    }
  }
  // Registry fallback: scan uninstall keys for 哔哩哔哩直播姬.
  try {
    const out = regQuery('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall /s');
    const m = out.match(/HKEY_[^\r\n]+Uninstall\\[^\r\n]*\r\n[^]*?DisplayName\s+REG_SZ\s+[^\r\n]*直播姬[^\r\n]*\r\n[^]*?InstallLocation\s+REG_SZ\s+([^\r\n]+)/);
    if (m) {
      const exe = path.join(m[1].trim(), "livehime.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** Detected paths for the three known apps (empty when not found). */
function knownApps() {
  return KNOWN_APPS.map((app) => ({
    id: app.id,
    name: app.name,
    path: app.detect()
  }));
}

/** The effective quick-launch list, seeding settings on first use. */
function list() {
  const raw = settings.get("quickLaunch");
  if (Array.isArray(raw)) {
    return raw.map((e, i) => ({
      id: typeof e.id === "string" && e.id ? e.id : `user-${i}`,
      name: String(e.name || ""),
      path: String(e.path || ""),
      args: typeof e.args === "string" ? e.args : ""
    }));
  }
  // First use: seed with the known apps.
  const seeded = knownApps().map((a) => ({ id: a.id, name: a.name, path: a.path, args: "" }));
  settings.set({ quickLaunch: seeded });
  return seeded;
}

/** Persist the edited list (validates array of {name, path}). */
function save(next) {
  const clean = (Array.isArray(next) ? next : [])
    .map((e) => ({ id: String(e.id || ""), name: String(e.name || "").trim(), path: String(e.path || "").trim(), args: String(e.args || "").trim() }))
    .filter((e) => e.name || e.path);
  settings.set({ quickLaunch: clean });
  return clean;
}

/**
 * Launch one entry. exe paths go through shell.openPath (returns an error
 * string on failure); entries with args spawn the binary instead.
 */
async function launch(entry) {
  const name = String(entry.name || entry.id || "快捷启动");
  const exe = String(entry.path || "");
  if (!exe) return { ok: false, error: `${name}：未配置程序路径` };
  if (!fs.existsSync(exe)) return { ok: false, error: `${name}：找不到程序（${exe}）` };
  try {
    const args = String(entry.args || "").trim();
    if (args) {
      const child = spawn(exe, args.split(/\s+/), { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      return { ok: true };
    }
    const error = await shell.openPath(exe);
    return error ? { ok: false, error: `${name}：${error}` } : { ok: true };
  } catch (error) {
    return { ok: false, error: `${name}：${error.message || error}` };
  }
}

/** File picker for adding an entry (returns an .exe/.app path or ""). */
async function pickExecutable() {
  const win = require("electron").BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: "选择要启动的程序",
    properties: ["openFile"],
    filters: process.platform === "win32"
      ? [{ name: "可执行文件", extensions: ["exe", "bat", "cmd", "lnk"] }]
      : [{ name: "应用程序", extensions: ["app"] }]
  });
  return result.canceled || !result.filePaths.length ? "" : result.filePaths[0];
}

module.exports = { list, save, launch, knownApps, pickExecutable };
