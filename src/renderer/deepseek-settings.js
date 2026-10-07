// Settings page for the DeepSeek backend. Everything here is local: the config
// round-trips to settings.json via IPC and nowhere else. The API address is
// empty by default, which means the official endpoint
// (https://api.deepseek.com); any other OpenAI-compatible gateway that serves
// DeepSeek models can be configured instead.

const enabledEl = document.getElementById("enabled");
const baseUrlEl = document.getElementById("baseUrl");
const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const modelListEl = document.getElementById("modelList");
const statusEl = document.getElementById("status");
const testBtn = document.getElementById("testBtn");
const saveBtn = document.getElementById("saveBtn");
const cancelBtn = document.getElementById("cancelBtn");
const toggleKeyBtn = document.getElementById("toggleKey");
const keyLinkEl = document.getElementById("keyLink");

let officialBaseUrl = "https://api.deepseek.com";

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = kind || "";
}

// A filled box that is just the official endpoint is the same as leaving it
// empty — treat it that way so the placeholder stays the single source of truth.
function baseUrlValue() {
  const value = baseUrlEl.value.trim().replace(/\/+$/, "");
  return value === officialBaseUrl ? "" : value;
}

function targetLabel() {
  return baseUrlValue() || officialBaseUrl;
}

window.deepseekApi
  .getConfig()
  .then((cfg) => {
    if (cfg?.officialBaseUrl) officialBaseUrl = cfg.officialBaseUrl;
    enabledEl.checked = Boolean(cfg.enabled);
    baseUrlEl.value = cfg.baseUrl || "";
    baseUrlEl.placeholder = `留空 = 官方 ${officialBaseUrl}`;
    apiKeyEl.value = cfg.apiKey || "";
    modelEl.value = cfg.model || "";
  })
  .catch(() => setStatus("读取配置失败", "err"));

keyLinkEl.addEventListener("click", (event) => {
  event.preventDefault();
  // Hardened webContents block navigation; open the key page in the browser.
  window.open(keyLinkEl.href, "_blank");
});

toggleKeyBtn.addEventListener("click", () => {
  apiKeyEl.type = apiKeyEl.type === "password" ? "text" : "password";
});

testBtn.addEventListener("click", async () => {
  setStatus(`正在连接 ${targetLabel()} …`);
  testBtn.disabled = true;
  try {
    const result = await window.deepseekApi.testConnection({
      baseUrl: baseUrlEl.value,
      apiKey: apiKeyEl.value
    });
    if (result?.ok) {
      const models = result.models || [];
      modelListEl.replaceChildren(
        ...models.map((id) => {
          const option = document.createElement("option");
          option.value = id;
          return option;
        })
      );
      setStatus(
        models.length
          ? `连接成功 · ${models.length} 个可用模型（模型框可下拉选择）`
          : "连接成功（未返回模型列表，请手动填写模型名）",
        "ok"
      );
    } else {
      setStatus(`连接失败：${result?.error || "未知错误"}`, "err");
    }
  } catch (error) {
    setStatus(`连接失败：${error?.message || error}`, "err");
  } finally {
    testBtn.disabled = false;
  }
});

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    await window.deepseekApi.setConfig({
      enabled: enabledEl.checked,
      baseUrl: baseUrlValue(),
      apiKey: apiKeyEl.value,
      model: modelEl.value
    });
    setStatus("已保存", "ok");
    setTimeout(() => window.deepseekApi.closeSettings(), 350);
  } catch (error) {
    setStatus(`保存失败：${error?.message || error}`, "err");
    saveBtn.disabled = false;
  }
});

cancelBtn.addEventListener("click", () => window.deepseekApi.closeSettings());
