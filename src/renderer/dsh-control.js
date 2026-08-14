// DSH 控制台 renderer: manages the DeepSeek Harness service (start/stop/status)
// and its sessions (list / send / steer / cancel) through the dshApi preload
// bridge. All state comes from the main process — nothing is stored here.

const L10N = {
  zh: {
    note: "管理 127.0.0.1:3080 的 DeepSeek Harness 服务：启动/停止、查看会话、直接给 agent 发消息或打断。",
    probing: "正在检测服务…",
    running: (extra) => `服务运行中（${extra || "127.0.0.1:3080"}）`,
    stopped: "服务未运行",
    start: "启动服务",
    stop: "停止服务",
    openPanel: "打开面板",
    refresh: "刷新",
    autoStart: "随 PRTS 启动 DSH 服务",
    sessionsLabel: "会话列表（点击选择发送目标）",
    noSessions: "（暂无会话 / 服务未运行）",
    msgLabel: "消息",
    msgPlaceholder: "向选中的 agent 发送消息…",
    send: "发送 (queue)",
    steer: "打断并重定向 (steer)",
    cancel: "停止当前回合",
    sessionsN: (n) => `· ${n} 个会话`,
    selecting: (id) => `已选择 ${id.slice(0, 8)}…`,
    selectFirst: "请先选择一个会话",
    runningTag: "运行中",
    idleTag: "空闲",
    sent: "已发送（queue）",
    steered: "已发送并打断（steer）",
    cancelled: "已停止当前回合",
    err: (text) => `错误：${text}`,
    ok: (text) => text,
    noService: "服务未运行，无法操作"
  },
  en: {
    note: "Manage the DeepSeek Harness service on 127.0.0.1:3080: start/stop it, list sessions, and message or interrupt the agent directly.",
    probing: "Detecting service…",
    running: (extra) => `Service running (${extra || "127.0.0.1:3080"})`,
    stopped: "Service stopped",
    start: "Start service",
    stop: "Stop service",
    openPanel: "Open panel",
    refresh: "Refresh",
    autoStart: "Start DSH with PRTS",
    sessionsLabel: "Sessions (click to pick the send target)",
    noSessions: "(no sessions / service not running)",
    msgLabel: "Message",
    msgPlaceholder: "Message the selected agent…",
    send: "Send (queue)",
    steer: "Interrupt & redirect (steer)",
    cancel: "Stop current turn",
    sessionsN: (n) => `· ${n} sessions`,
    selecting: (id) => `Selected ${id.slice(0, 8)}…`,
    selectFirst: "Select a session first",
    runningTag: "running",
    idleTag: "idle",
    sent: "Sent (queue)",
    steered: "Sent & steered",
    cancelled: "Stopped current turn",
    err: (text) => `Error: ${text}`,
    ok: (text) => text,
    noService: "Service not running — action unavailable"
  }
};

const lang = (navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
const T = L10N[lang];
const $ = (id) => document.getElementById(id);

const statusDot = $("statusDot");
const statusText = $("statusText");
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const openBtn = $("openBtn");
const refreshBtn = $("refreshBtn");
const autoStartEl = $("autoStart");
const sessionsEl = $("sessions");
const sessionsHint = $("sessionsHint");
const msgEl = $("msg");
const sendBtn = $("sendBtn");
const steerBtn = $("steerBtn");
const cancelBtn = $("cancelBtn");
const statusLine = $("status");

let selectedSessionId = null;
let sessions = [];
let busy = false;

function setStatus(text, kind) {
  statusLine.textContent = text || "";
  statusLine.className = kind || "";
}

function setBusy(value) {
  busy = value;
  [sendBtn, steerBtn, cancelBtn, startBtn, stopBtn, refreshBtn].forEach((b) => {
    b.disabled = value;
  });
}

function renderSessions() {
  sessionsEl.replaceChildren();
  if (sessions.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = T.noSessions;
    sessionsEl.appendChild(hint);
    return;
  }
  for (const item of sessions) {
    const row = document.createElement("div");
    row.className = "session-row";
    if (item.sessionId === selectedSessionId) row.classList.add("selected");
    const dot = document.createElement("span");
    dot.className = "sdot" + (item.running ? " on" : "");
    dot.title = item.running ? T.runningTag : T.idleTag;
    const sid = document.createElement("span");
    sid.className = "sid";
    sid.textContent = item.sessionId.replace(/^session-/, "").slice(0, 8);
    // Conversation display name: the DSH title projection (projections.values
    // .title), falling back to the cwd basename, then the short session id.
    const title =
      typeof item.projections?.values?.title === "string"
        ? item.projections.values.title.trim()
        : "";
    const cwdBase = item.cwd
      ? String(item.cwd).split(/[\\/]/).filter(Boolean).pop() || ""
      : "";
    const name = title || cwdBase || item.sessionId.slice(0, 8);
    const meta = document.createElement("span");
    meta.className = "smeta";
    meta.textContent = name;
    meta.title = `${item.sessionId}\n${item.cwd || ""}\n${item.running ? T.runningTag : T.idleTag}`;
    row.append(dot, sid, meta);
    row.addEventListener("click", () => {
      selectedSessionId = item.sessionId;
      renderSessions();
      setStatus(T.selecting(item.sessionId));
    });
    sessionsEl.appendChild(row);
  }
}

async function refreshStatus() {
  try {
    const st = await window.dshApi.getStatus();
    if (st.running) {
      statusDot.classList.add("on");
      statusText.textContent = T.running(st.pid ? `PID ${st.pid}` : null);
      startBtn.disabled = true;
      stopBtn.disabled = false;
      openBtn.disabled = false;
      if (st.error) setStatus(T.err(st.error), "err");
    } else {
      statusDot.classList.remove("on");
      statusText.textContent = T.stopped;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      openBtn.disabled = true;
    }
    return st.running;
  } catch (error) {
    statusDot.classList.remove("on");
    statusText.textContent = T.stopped;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    openBtn.disabled = true;
    return false;
  }
}

async function refreshSessions() {
  const running = await refreshStatus();
  if (!running) {
    sessions = [];
    renderSessions();
    return;
  }
  try {
    const result = await window.dshApi.listSessions();
    if (result && result.ok) {
      sessions = result.value.items || [];
      if (selectedSessionId && !sessions.some((s) => s.sessionId === selectedSessionId)) {
        selectedSessionId = null;
      }
      renderSessions();
      const st = await window.dshApi.getStatus();
      if (st.sessions !== undefined) statusText.textContent = T.running() + " " + T.sessionsN(st.sessions);
    } else if (result && result.error) {
      setStatus(T.err(result.error.message), "err");
    }
  } catch (error) {
    setStatus(T.err(error.message || String(error)), "err");
  }
}

async function runAction(action, okKey) {
  if (busy) return;
  setBusy(true);
  setStatus("");
  try {
    const result = await action();
    if (result && result.ok === false) {
      setStatus(T.err(result.error.message), "err");
    } else {
      setStatus(T.ok(okKey), "ok");
    }
    return result;
  } catch (error) {
    setStatus(T.err(error.message || String(error)), "err");
    return null;
  } finally {
    setBusy(false);
  }
}

async function handleSend(mode) {
  const text = msgEl.value.trim();
  if (!text) return;
  if (!selectedSessionId) {
    setStatus(T.err(T.selectFirst), "err");
    return;
  }
  const result = await runAction(
    () => window.dshApi.send(selectedSessionId, text, mode),
    mode === "steer" ? T.steered : T.sent
  );
  if (result && result.ok) msgEl.value = "";
  setTimeout(refreshSessions, 1500);
}

async function handleCancel() {
  if (!selectedSessionId) return;
  const result = await runAction(
    () => window.dshApi.cancel(selectedSessionId),
    T.cancelled
  );
  setTimeout(refreshSessions, 1200);
}

startBtn.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await window.dshApi.start();
    if (result && result.ok) {
      setStatus(T.ok(T.running()), "ok");
    } else {
      setStatus(T.err(result && result.error ? result.error : "start failed"), "err");
    }
  } catch (error) {
    setStatus(T.err(error.message || String(error)), "err");
  } finally {
    setBusy(false);
    refreshSessions();
  }
});

stopBtn.addEventListener("click", async () => {
  setBusy(true);
  try {
    const result = await window.dshApi.stop();
    if (result && result.ok) {
      setStatus(T.ok(T.stopped), "ok");
    } else {
      setStatus(T.err("stop failed"), "err");
    }
  } catch (error) {
    setStatus(T.err(error.message || String(error)), "err");
  } finally {
    setBusy(false);
    refreshSessions();
  }
});

openBtn.addEventListener("click", () => window.dshApi.openPanel());
refreshBtn.addEventListener("click", () => refreshSessions());

autoStartEl.addEventListener("change", () => {
  window.dshApi.setAutoStart(autoStartEl.checked).then(() => {
    setStatus(T.ok(T.autoStart), "ok");
  });
});

sendBtn.addEventListener("click", () => handleSend("queue"));
steerBtn.addEventListener("click", () => handleSend("steer"));
cancelBtn.addEventListener("click", handleCancel);
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSend("queue");
  }
});

// Initial paint + periodic refresh while the window is open.
refreshSessions();
const timer = setInterval(() => refreshSessions(), 5000);
window.addEventListener("beforeunload", () => clearInterval(timer));
window.dshApi.getAutoStart().then((value) => {
  autoStartEl.checked = value === true;
});
