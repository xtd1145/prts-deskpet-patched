// Embedded DSH control view for the PRTS popover (index.html).
//
// Two modes, switched by the tabs above the pet stage:
//   - 对话 (chat)  — the normal conversation surface (default, unchanged).
//   - 控制 · DSH   — an embedded DeepSeek Harness control panel. Entering this
//     mode WAKES the DSH service (dshApi.start — a no-op when it already runs)
//     and then loads status + sessions. All ids are prefixed `dshc` so nothing
//     collides with the chat renderer's own element ids.
//
// Self-contained IIFE: no globals leak into the popover's shared page.
(() => {
  "use strict";

  if (!window.dshApi) return; // preload missing — nothing to wire

  const $ = (id) => document.getElementById(id);
  // NOTE: the composer wrapper is <footer class="composer"> (no id — the id
  // "composer" belongs to the inner form), so select it by tag/class.
  const chatMode = {
    petStage: $("petStage"),
    mainArea: $("mainArea"),
    composer: document.querySelector("footer.composer") || $("composer")
  };
  const controlView = $("dshControlView");
  const modeChatBtn = $("modeChat");
  const modeControlBtn = $("modeControl");

  // ── localization ──
  const L10N = {
    zh: {
      statusChecking: "检测 DSH 服务…",
      statusRunning: (n) => `服务运行中${n ? ` · ${n} 个会话` : ""}`,
      statusStopped: "服务未运行",
      wakeOk: "DSH 已唤醒",
      wakeErr: (t) => `唤醒失败：${t}`,
      stoppedOk: "服务已停止",
      noService: "服务未运行，无法操作",
      selectFirst: "请先选择一个会话",
      selectTarget: (id) => `已选择 ${id.slice(0, 8)}…`,
      runningTag: "运行中",
      idleTag: "空闲",
      sent: "已发送（queue）",
      steered: "已发送并打断（steer）",
      cancelled: "已停止当前回合",
      err: (t) => `错误：${t}`
    },
    en: {
      statusChecking: "Detecting DSH service…",
      statusRunning: (n) => `Service running${n ? ` · ${n} sessions` : ""}`,
      statusStopped: "Service stopped",
      wakeOk: "DSH woken",
      wakeErr: (t) => `Wake failed: ${t}`,
      stoppedOk: "Service stopped",
      noService: "Service not running — action unavailable",
      selectFirst: "Select a session first",
      selectTarget: (id) => `Selected ${id.slice(0, 8)}…`,
      runningTag: "running",
      idleTag: "idle",
      sent: "Sent (queue)",
      steered: "Sent & steered",
      cancelled: "Stopped current turn",
      err: (t) => `Error: ${t}`
    }
  };
  const T = L10N[(navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en"];

  // ── element refs ──
  const statusDot = $("dshcStatusDot");
  const statusText = $("dshcStatusText");
  const startBtn = $("dshcStartBtn");
  const stopBtn = $("dshcStopBtn");
  const openBtn = $("dshcOpenBtn");
  const refreshBtn = $("dshcRefreshBtn");
  const autoStartEl = $("dshcAutoStart");
  const sessionsEl = $("dshcSessions");
  const sessionsHint = $("dshcSessionsHint");
  const msgEl = $("dshcMsg");
  const sendBtn = $("dshcSendBtn");
  const steerBtn = $("dshcSteerBtn");
  const cancelBtn = $("dshcCancelBtn");
  const statusLine = $("dshcStatusLine");

  let selectedSessionId = null;
  let sessions = [];
  let busy = false;
  let refreshTimer = null;
  let active = false; // control view currently visible

  function setStatus(text, kind) {
    statusLine.textContent = text || "";
    statusLine.className = "dshc-status-line dshc-small" + (kind ? " " + kind : "");
  }

  function setBusy(value) {
    busy = value;
    [startBtn, stopBtn, refreshBtn, sendBtn, steerBtn, cancelBtn].forEach((b) => {
      b.disabled = value;
    });
  }

  function renderSessions() {
    sessionsEl.replaceChildren();
    if (!sessions.length) {
      const hint = document.createElement("div");
      hint.className = "dshc-empty";
      hint.textContent = sessionsHint.textContent;
      sessionsEl.appendChild(hint);
      return;
    }
    for (const item of sessions) {
      const row = document.createElement("div");
      row.className = "dshc-session-row" + (item.sessionId === selectedSessionId ? " selected" : "");
      const dot = document.createElement("span");
      dot.className = "sdot" + (item.running ? " on" : "");
      dot.title = item.running ? T.runningTag : T.idleTag;
      const sid = document.createElement("span");
      sid.className = "sid";
      sid.textContent = item.sessionId.replace(/^session-/, "").slice(0, 8);
      // Conversation display name: the DSH title projection
      // (projections.values.title), falling back to the cwd basename, then
      // the short session id.
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
        setStatus(T.selectTarget(item.sessionId));
      });
      sessionsEl.appendChild(row);
    }
  }

  async function refreshStatus() {
    if (!active) return false;
    try {
      const st = await window.dshApi.getStatus();
      if (st.running) {
        statusDot.classList.add("on");
        statusText.textContent = st.sessions !== undefined && st.sessions > 0
          ? T.statusRunning(st.sessions)
          : T.statusRunning(0);
        startBtn.disabled = false;
        stopBtn.disabled = false;
        openBtn.disabled = false;
        if (st.error) setStatus(T.err(st.error), "err");
      } else {
        statusDot.classList.remove("on");
        statusText.textContent = T.statusStopped;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        openBtn.disabled = true;
      }
      return st.running;
    } catch (error) {
      statusDot.classList.remove("on");
      statusText.textContent = T.statusStopped;
      return false;
    }
  }

  async function refreshSessions() {
    if (!active) return;
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
        if (st.sessions !== undefined) statusText.textContent = T.statusRunning(st.sessions);
      } else if (result && result.error) {
        setStatus(T.err(result.error.message), "err");
      }
    } catch (error) {
      setStatus(T.err(error.message || String(error)), "err");
    }
  }

  async function runAction(action, okText) {
    if (busy) return null;
    setBusy(true);
    setStatus("");
    try {
      const result = await action();
      if (result && result.ok === false) {
        setStatus(T.err(result.error.message), "err");
      } else {
        setStatus(okText);
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
    await runAction(() => window.dshApi.cancel(selectedSessionId), T.cancelled);
    setTimeout(refreshSessions, 1200);
  }

  // ── mode switching ──
  function setMode(mode) {
    const isControl = mode === "control";
    active = isControl;
    modeChatBtn.classList.toggle("active", !isControl);
    modeControlBtn.classList.toggle("active", isControl);
    modeChatBtn.setAttribute("aria-selected", String(!isControl));
    modeControlBtn.setAttribute("aria-selected", String(isControl));
    for (const el of [chatMode.petStage, chatMode.mainArea, chatMode.composer]) {
      if (el) el.hidden = isControl;
    }
    controlView.hidden = !isControl;
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (isControl) {
      // Wake DSH if it is not running, then load status + sessions.
      statusText.textContent = T.statusChecking;
      setStatus("");
      window.dshApi.start().then((result) => {
        if (!(result && result.ok)) setStatus(T.err(result && result.error ? result.error : "wake failed"), "err");
        return refreshSessions();
      }).then(() => {
        if (active) refreshTimer = setInterval(() => refreshSessions(), 5000);
      });
    } else {
      setStatus("");
    }
  }

  modeChatBtn.addEventListener("click", () => setMode("chat"));
  modeControlBtn.addEventListener("click", () => setMode("control"));

  // ── control panel wiring ──
  startBtn.addEventListener("click", async () => {
    setBusy(true);
    try {
      const result = await window.dshApi.start();
      if (result && result.ok) setStatus(T.wakeOk);
      else setStatus(T.err(result && result.error ? result.error : "wake failed"), "err");
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
      if (result && result.ok) setStatus(T.stoppedOk);
      else setStatus(T.err("stop failed"), "err");
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
      setStatus(autoStartEl.checked ? "随 PRTS 启动 DSH：已开启" : "随 PRTS 启动 DSH：已关闭");
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

  window.dshApi.getAutoStart().then((value) => {
    autoStartEl.checked = value === true;
  });
})();
