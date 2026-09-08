// DeepSeek Harness (DSH) integration for PRTS.
//
// Responsibilities:
//   1. Service management — start/stop the dsh web server that listens on
//      127.0.0.1:3080 (the same process 启动DSH.bat launches), probe the port,
//      and track the child we spawn.
//   2. Minimal RPC client — the DSH web API speaks the four-quadrant RPC wire
//      format (POST /api/<method> with a {type:'client-request', rpcId, method,
//      payload} body; the response is a {type:'server-response', rpcId, result}
//      JSON body). This file only needs the session domain: list, prompt
//      (queue/steer), cancel, and host.describe.
//
// Everything is plain Node (no Electron imports) so it can be unit-tested with
// `node` directly; callers inject the settings facade.
"use strict";

const { spawn, execFile } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, createHmac } = require("node:crypto");

const DSH_PORT = 3080;
const DSH_BASE = `http://127.0.0.1:${DSH_PORT}`;
const DSH_START_WAIT_MS = 15000;
const DSH_RPC_TIMEOUT_MS = 15000;
// DSH web (0.1.x) guards /api behind a browser-session cookie: the server
// signs cookies with a per-home secret persisted at <DSH_HOME>/.credentials.yaml
// under client-connection/browser-session. The pet re-creates the same cookie
// (name dsh-auth-<sha256(authority)>, value v1.<payload>.<hmac>) so its DSH
// console works whether the service was started by PRTS or by hand.
const DSH_AUTH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function dshHomeDir() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

// Tiny indentation-tolerant reader for the browser-session signing secret.
let secretCache = { file: null, mtimeMs: -1, secret: undefined };
function browserSessionSecret() {
  const file = path.join(dshHomeDir(), ".credentials.yaml");
  try {
    const stat = fs.statSync(file);
    if (secretCache.file === file && secretCache.mtimeMs === stat.mtimeMs) {
      return secretCache.secret;
    }
    const raw = fs.readFileSync(file, "utf8");
    let secret;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s+client-connection\/browser-session:/.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
        const m = lines[j].match(/^\s+secret:\s*"?([A-Za-z0-9_-]+)"?\s*$/);
        if (m) {
          secret = m[1];
          break;
        }
        if (/^\S/.test(lines[j])) break;
      }
      break;
    }
    secretCache = { file, mtimeMs: stat.mtimeMs, secret };
    return secret;
  } catch {
    secretCache = { file, mtimeMs: -1, secret: undefined };
    return undefined;
  }
}

function encodeBase64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build the authority-bound signed cookie the DSH web server expects. */
function browserAuthCookie(secret) {
  const authority = `127.0.0.1:${DSH_PORT}`;
  const name = "dsh-auth-" + encodeBase64Url(createHash("sha256").update(authority).digest());
  const key = Buffer.from(secret, "base64url");
  const payload = {
    version: 1,
    authority,
    issuedAt: Date.now(),
    expiresAt: Date.now() + DSH_AUTH_MAX_AGE_MS
  };
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = encodeBase64Url(createHmac("sha256", key).update(body).digest());
  return `${name}=v1.${body}.${signature}`;
}

/** Cookie header for the DSH web /api browser-trust fence, when available. */
function authCookieHeader() {
  const secret = browserSessionSecret();
  return secret ? browserAuthCookie(secret) : undefined;
}

// Electron main exposes globalThis.fetch since Electron 25; net.fetch exists in
// every supported Electron. Prefer the WHATWG global, fall back to net.fetch.
const doFetch =
  typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
    ? (input, init) => globalThis.fetch(input, init)
    : (input, init) => require("electron").net.fetch(input, init);

/**
 * Try to locate a real `dsh` CLI on this machine beyond the well-known dirs:
 *   - `npm root -g` (npm global installs);
 *   - resolving `dsh` from PATH and deriving its package dir (npm .bin shims
 *     live inside node_modules/.bin, the package one level up).
 * Windows cannot spawn a bare `dsh` (.cmd shim), so returning the absolute
 * bin.js (run through node) is what makes startup actually work.
 */
function discoverDshBin() {
  const { spawnSync } = require("node:child_process");
  const existing = (p) => (p && fs.existsSync(p) ? p : undefined);
  try {
    const npmRoot = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["root", "-g"],
      { encoding: "utf8", timeout: 8000, windowsHide: true }
    );
    if (!npmRoot.error && npmRoot.status === 0) {
      const root = String(npmRoot.stdout || "").trim();
      if (root) {
        const hit = existing(path.join(root, "@deepseek-ai", "dsh", "lib", "bin.js"));
        if (hit) return hit;
      }
    }
  } catch {
    /* npm unavailable — keep probing */
  }
  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const out = spawnSync(cmd, ["dsh"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    if (!out.error && out.status === 0) {
      const first = String(out.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) {
        const shimDir = path.dirname(first); // .../node_modules/.bin
        const pkgDir = path.join(shimDir, "..");
        const hit = existing(path.join(pkgDir, "@deepseek-ai", "dsh", "lib", "bin.js"));
        if (hit) return hit;
        // npx layout: .../_npx/<hash>/node_modules/.bin → package under node_modules
        const hit2 = existing(path.join(path.dirname(pkgDir), "..", "@deepseek-ai", "dsh", "lib", "bin.js"));
        if (hit2) return hit2;
      }
    }
  } catch {
    /* command not found */
  }
  // npx / npm exec cache installs: <npm-cache>/_npx/<hash>/node_modules/@deepseek-ai/dsh/lib/bin.js.
  // `npx @deepseek-ai/dsh web` — the way DeepSeek Harness is commonly launched —
  // never touches npm global dirs, so this scan is what finds it.
  const npxRoots = [];
  if (process.platform === "win32") {
    if (process.env.LOCALAPPDATA) npxRoots.push(path.join(process.env.LOCALAPPDATA, "npm-cache", "_npx"));
    if (process.env.APPDATA) npxRoots.push(path.join(process.env.APPDATA, "npm-cache", "_npx"));
  } else {
    npxRoots.push(path.join(os.homedir(), ".npm", "_npx"));
  }
  for (const root of npxRoots) {
    try {
      for (const entry of fs.readdirSync(root)) {
        const hit = existing(
          path.join(root, entry, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
        );
        if (hit) return hit;
      }
    } catch {
      /* cache dir missing — keep looking */
    }
  }
  return undefined;
}

/**
 * Resolve how to launch the dsh CLI, platform-aware:
 *   1. explicit settings/env overrides (dshNodePath + dshBinPath) win;
 *   2. known install locations (Windows legacy install, npm global dirs);
 *   3. dynamic discovery (npm root -g / `dsh` on PATH);
 *   4. the `dsh` command on PATH as the last resort (mac/Linux default).
 * Returns { cmd, args } ready for spawn().
 */
function launchConfig(settings) {
  const extraArgs = (settings.get("dshArgs") || "web").split(/\s+/).filter(Boolean);
  const nodePath = settings.get("dshNodePath") || process.env.PRTS_DSH_NODE || "node";
  const binPath = settings.get("dshBinPath");
  if (binPath) return { cmd: nodePath, args: [binPath, ...extraArgs] };
  const candidates = [];
  if (process.platform === "win32") {
    // The legacy install used by 启动DSH.bat on this machine.
    candidates.push("C:\\Windows\\System32\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js");
    // npm global install (Windows).
    candidates.push(
      path.join(process.env.APPDATA || "", "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
    );
  } else {
    // npm global install (macOS / Linux), common prefixes.
    candidates.push("/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js");
    candidates.push(path.join(process.env.HOME || "", ".npm-global", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
  }
  const discovered = discoverDshBin();
  if (discovered) candidates.push(discovered);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return { cmd: nodePath, args: [candidate, ...extraArgs] };
    }
  }
  // Fall back to the `dsh` command on PATH (npm global bin — works on
  // mac/Linux where it is a real executable, not a .cmd shim).
  return { cmd: "dsh", args: [...extraArgs] };
}

// The child we spawned (null when the service was started externally).
let child = null;

/** Probe whether something listens on 127.0.0.1:DSH_PORT. */
function isRunning(timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: DSH_PORT });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* already destroyed */
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** Poll until the service accepts connections, or the deadline passes. */
async function waitForUp(maxMs = DSH_START_WAIT_MS) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isRunning(300)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return isRunning(300);
}

/**
 * Start the DSH web service. If the port is already served (started by the
 * user's 启动DSH.bat, by a previous PRTS session, or by hand) this is a no-op.
 * Returns { ok, already, pid }. When a logFile is given, the child's stdout and
 * stderr are appended there (created on demand).
 */
async function start({ logFile, settings } = {}) {
  if (await isRunning(300)) return { ok: true, already: true, pid: null };
  const cfg = launchConfig(settings || { get: () => undefined });
  let stdio = "ignore";
  let stdioStream = null;
  if (logFile) {
    try {
      stdioStream = fs.openSync(logFile, "a");
      stdio = [stdioStream, stdioStream, stdioStream];
    } catch {
      /* fall back to ignore */
    }
  }
  // spawn() reports ENOENT and friends *asynchronously* through the child's
  // 'error' event — without a listener that becomes an uncaught exception in
  // the main process. Attach one before anything else and fold the failure
  // into a clean { ok: false, error } result instead of crashing.
  const spawned = spawn(cfg.cmd, cfg.args, {
    detached: true,
    windowsHide: true,
    stdio
  });
  let spawnError = null;
  spawned.once("error", (error) => {
    spawnError = error;
  });
  spawned.unref();
  child = spawned;
  const pid = spawned.pid;
  if (stdioStream !== null) {
    try {
      fs.closeSync(stdioStream);
    } catch {
      /* ignore */
    }
  }
  const deadline = Date.now() + DSH_START_WAIT_MS;
  while (Date.now() < deadline) {
    if (spawnError) {
      child = null;
      const code = spawnError.code ? ` (${spawnError.code})` : "";
      const detail = (spawnError.message || String(spawnError)).slice(0, 160);
      const hint =
        "未找到可用的 dsh CLI。请先安装 DeepSeek Harness（托盘 → DSH 控制台可触发安装），" +
        "或在 DSH 控制台设置 node 与 dsh 的完整路径（settings.json 的 dshNodePath / dshBinPath）后重试。";
      return { ok: false, error: `无法启动 dsh${code}：${detail}。${hint}`, pid: null };
    }
    if (await isRunning(300)) return { ok: true, already: false, pid };
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return {
    ok: false,
    error: `DSH 服务启动超时（${DSH_START_WAIT_MS / 1000}s 内未监听 ${DSH_PORT} 端口）`,
    pid: child && child.pid
  };
}

/** Find the PID listening on 127.0.0.1:<port> (Windows netstat). Exported for tests. */
function pidOnPort(port) {
  return new Promise((resolve) => {
    execFile("netstat", ["-ano", "-p", "tcp"], (error, stdout) => {
      if (error) return resolve(null);
      // netstat columns: Proto  Local  Foreign  State  PID — the proto column
      // precedes the local address, so after the local address there is exactly
      // one \S+ run (the foreign address) before LISTENING.
      const pattern = new RegExp(
        `\\s127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`
      );
      const match = stdout.match(pattern);
      resolve(match ? Number(match[1]) : null);
    });
  });
}

/** Force-kill one PID and its process tree. Exported for tests. */
function killPid(pid) {
  return new Promise((resolve) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve());
  });
}

/**
 * Stop the DSH service: prefer the child we spawned; otherwise resolve the PID
 * owning the port and kill it (covers externally-started servers too).
 * Never touches unrelated processes — the PID comes from the port owner.
 */
async function stop() {
  let pid = child && child.pid ? child.pid : null;
  if (!pid) pid = await pidOnPort(DSH_PORT);
  child = null;
  if (!pid) return { ok: true, already: false, pid: null };
  await killPid(pid);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const up = await isRunning(300);
  return { ok: !up, stopped: !up, pid };
}

/** One RPC call against the DSH web API. Returns the `result` slot.
 *  `wireArgs` is the exact args object placed under `payload.args` — the
 *  current DSH validates argument *names* against each endpoint's single
 *  parameter (session.list wants `{ _request: {} }`, most others `{ request:
 *  {...} }`), so callers assemble it per method.
 */
async function rpc(method, wireArgs, timeoutMs = DSH_RPC_TIMEOUT_MS) {
  const rpcId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json" };
    const cookie = authCookieHeader();
    if (cookie) headers.cookie = cookie;
    // Current DSH routes /api/<namespace>/<method> (session.list → session/list)
    // and expects the envelope's `method` to carry the same slash form. Older
    // builds used the dotted method directly; try the slash form first and only
    // fall back on a genuine 404 (nothing was dispatched).
    const dotted = method.includes(".") ? method : undefined;
    const slashRoute = method.replace(/\./g, "/");
    const routes = dotted && dotted !== slashRoute ? [slashRoute, dotted] : [slashRoute];
    let response;
    let wireMethod = slashRoute;
    for (let i = 0; i < routes.length; i += 1) {
      wireMethod = routes[i];
      response = await doFetch(`${DSH_BASE}/api/${wireMethod}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "client-request",
          rpcId,
          method: wireMethod,
          payload: { args: wireArgs && typeof wireArgs === "object" ? wireArgs : {} }
        }),
        signal: controller.signal
      });
      if (response.ok || response.status !== 404 || routes.length === 1) break;
    }
    // The web service answers with a plain-text 401 ("unauthorized") when the
    // browser-session cookie is missing/invalid — never try to JSON-parse it.
    if (!response.ok) {
      let detail = "";
      try {
        detail = String(await response.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      let hint = "";
      if (response.status === 401) {
        hint = cookie
          ? "（浏览器会话凭据无效或已过期，请重新打开一次 DSH 面板）"
          : "（未找到 DSH 浏览器会话凭据，请先打开一次 DSH 面板完成配对）";
      }
      throw new Error(`DSH 请求失败（${method} HTTP ${response.status}${detail ? `: ${detail}` : ""}）${hint}`);
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`DSH 响应异常（${method}）：${error && error.message ? error.message : String(error)}`);
    }
    if (
      !body ||
      body.type !== "server-response" ||
      body.rpcId !== rpcId ||
      !body.result
    ) {
      throw new Error(`DSH 响应异常（method=${method}）`);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** host.describe — cheap read-only health/identity probe (best effort). */
function describe() {
  return rpc("host.describe", { _request: {} });
}

/** session.list — { items: SessionSummary[] } (running flags, titles…). */
function listSessions() {
  return rpc("session.list", { _request: {} });
}

/** session.prompt — mode 'steer' interrupts and redirects; other modes enqueue. */
function send(sessionId, text, mode) {
  let clientTimeZone;
  try {
    clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    clientTimeZone = undefined;
  }
  return rpc("session.prompt", {
    request: {
      sessionId,
      mode: mode === "steer" ? "steer" : "queue",
      content: [{ type: "text", text }],
      ...(clientTimeZone ? { clientTimeZone } : {})
    }
  });
}

/** session.cancel — stop the active turn, keep the pending queue. */
function cancel(sessionId) {
  return rpc("session.cancel", { request: { sessionId } });
}

/** Aggregated status for the tray/panel: running + session count + last error. */
async function status() {
  const running = await isRunning(300);
  if (!running) return { running: false, sessions: 0, error: null, port: DSH_PORT };
  try {
    const result = await listSessions();
    if (result.ok) {
      return {
        running: true,
        sessions: Array.isArray(result.value.items) ? result.value.items.length : 0,
        error: null,
        port: DSH_PORT
      };
    }
    return { running: true, sessions: 0, error: result.error.message, port: DSH_PORT };
  } catch (error) {
    return { running: true, sessions: 0, error: error.message, port: DSH_PORT };
  }
}

/** Whether the dsh CLI is installed on this machine (any known location). */
function isInstalled(settingsFacade) {
  const cfg = launchConfig(settingsFacade || { get: () => undefined });
  // A PATH fallback (cmd === "dsh") is only "installed" if the command resolves.
  if (cfg.cmd === "dsh") {
    const { spawnSync } = require("node:child_process");
    try {
      const probe = spawnSync(cfg.cmd, ["--version"], { stdio: "ignore", timeout: 5000 });
      return !probe.error && probe.status === 0;
    } catch {
      return false;
    }
  }
  return fs.existsSync(cfg.args[0]);
}

module.exports = {
  DSH_PORT,
  DSH_BASE,
  isRunning,
  waitForUp,
  start,
  stop,
  pidOnPort,
  killPid,
  rpc,
  describe,
  listSessions,
  send,
  cancel,
  status,
  isInstalled
};
