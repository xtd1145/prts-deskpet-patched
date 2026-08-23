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

const DSH_PORT = 3080;
const DSH_BASE = `http://127.0.0.1:${DSH_PORT}`;
const DSH_START_WAIT_MS = 15000;
const DSH_RPC_TIMEOUT_MS = 15000;

// Electron main exposes globalThis.fetch since Electron 25; net.fetch exists in
// every supported Electron. Prefer the WHATWG global, fall back to net.fetch.
const doFetch =
  typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
    ? (input, init) => globalThis.fetch(input, init)
    : (input, init) => require("electron").net.fetch(input, init);

/**
 * Resolve how to launch the dsh CLI, platform-aware:
 *   1. explicit settings/env overrides (dshNodePath + dshBinPath) win;
 *   2. known install locations (Windows legacy install, npm global dirs);
 *   3. the `dsh` command on PATH (npm global bin — the mac/Linux default).
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
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return { cmd: nodePath, args: [candidate, ...extraArgs] };
    }
  }
  // Fall back to the `dsh` command on PATH (npm global bin).
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
  try {
    child = spawn(cfg.cmd, cfg.args, {
      detached: true,
      windowsHide: true,
      stdio
    });
    child.unref();
    const pid = child.pid;
    if (stdioStream !== null) fs.closeSync(stdioStream);
    const up = await waitForUp();
    if (!up) {
      return {
        ok: false,
        error: `DSH 服务启动超时（${DSH_START_WAIT_MS / 1000}s 内未监听 ${DSH_PORT} 端口）`,
        pid
      };
    }
    return { ok: true, already: false, pid };
  } catch (error) {
    return { ok: false, error: error.message, pid: child && child.pid };
  }
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

/** One RPC call against the DSH web API. Returns the `result` slot. */
async function rpc(method, payload, timeoutMs = DSH_RPC_TIMEOUT_MS) {
  const rpcId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(`${DSH_BASE}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method,
        payload
      }),
      signal: controller.signal
    });
    const body = await response.json();
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

/** host.describe — cheap read-only health/identity probe. */
function describe() {
  return rpc("host.describe", {});
}

/** session.list — { items: SessionSummary[] } (running flags, titles…). */
function listSessions() {
  return rpc("session.list", {});
}

/** session.prompt — mode 'queue' appends; 'steer' interrupts and redirects. */
function send(sessionId, text, mode) {
  let clientTimeZone;
  try {
    clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    clientTimeZone = undefined;
  }
  return rpc("session.prompt", {
    sessionId,
    mode,
    content: [{ type: "text", text }],
    ...(clientTimeZone ? { clientTimeZone } : {})
  });
}

/** session.cancel — stop the active turn, keep the pending queue. */
function cancel(sessionId) {
  return rpc("session.cancel", { sessionId });
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
