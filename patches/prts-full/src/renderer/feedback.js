// 意见反馈 window renderer: pick a type (feature / bug), fill the report,
// submit to GitHub Issues (device-flow auth on first use).
const $ = (id) => document.getElementById(id);
const typeCards = [...document.querySelectorAll(".type-card")];
const titleEl = $("title");
const bodyEl = $("body");
const submitBtn = $("submitBtn");
const statusEl = $("status");
const deviceBox = $("deviceBox");
const deviceCodeEl = $("deviceCode");
const deviceUriEl = $("deviceUri");

let currentType = "feature";

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = kind || "";
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  typeCards.forEach((c) => (c.style.pointerEvents = busy ? "none" : ""));
}

for (const card of typeCards) {
  card.addEventListener("click", () => {
    currentType = card.dataset.type;
    typeCards.forEach((c) => c.classList.toggle("selected", c === card));
  });
}

// The main process pushes the device code while it waits for authorization.
window.feedbackApi?.onDeviceCode?.((payload) => {
  deviceBox.style.display = "block";
  deviceCodeEl.textContent = payload.userCode || "";
  deviceUriEl.href = payload.verificationUri || "https://github.com/login/device";
});

submitBtn.addEventListener("click", async () => {
  const title = titleEl.value.trim();
  const body = bodyEl.value.trim();
  if (!title) { setStatus("请填写标题", "err"); return; }
  if (!body) { setStatus("请填写详细描述", "err"); return; }
  setBusy(true);
  setStatus("正在提交…");
  deviceBox.style.display = "none";
  try {
    const result = await window.feedbackApi.submit({ type: currentType, title, body });
    if (result && result.ok) {
      setStatus(`已提交 Issue #${result.number}`, "ok");
      deviceBox.style.display = "none";
      setTimeout(() => window.close(), 1600);
    } else {
      const msg = result && result.error ? result.error : "提交失败";
      const prefill = result && result.prefill;
      setStatus(`${msg}${prefill ? " — 可在浏览器中打开预填页面手动提交。" : ""}`, "err");
      if (prefill) {
        window.feedbackApi.openPrefilled(prefill);
      }
    }
  } catch (error) {
    setStatus(`提交失败：${error.message || error}`, "err");
  } finally {
    setBusy(false);
  }
});
