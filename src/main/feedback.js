// ============================================================
//  意见反馈 — submit feedback (feature request / bug report) to
//  the project's GitHub Issues.
//
//  Auth: GitHub OAuth device flow (the Doctor authorizes once in
//  the browser; the resulting token is cached in settings.json and
//  can be revoked from GitHub anytime). With the token the app
//  creates the issue directly via the Issues API, labels included
//  (bug / feature-request). If the flow is cancelled or fails, the
//  window offers a pre-filled "new issue" URL as a fallback.
// ============================================================

const { net, shell } = require("electron");
const settings = require("./settings");

// The public OAuth client id of the GitHub CLI device flow. It is what the
// browser authorization page shows ("GitHub CLI"); any device flow against
// GitHub must present a registered client id.
const GITHUB_CLIENT_ID = "178c6fc778ccc68e1d6a";
const REPO_OWNER = "xtd1145";
const REPO_NAME = "prts-deskpet-patched";
const ISSUES_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`;
const LABELS_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/labels`;
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const UA = { "User-Agent": "PRTS-feedback", Accept: "application/vnd.github+json" };

const LABELS = {
  feature: "feature-request",
  bug: "bug"
};

async function postJson(url, body, token, extraHeaders = {}) {
  const res = await net.fetch(url, {
    method: "POST",
    headers: {
      ...UA,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new Error(json?.message || `HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  return json;
}

/** Ensure the two feedback labels exist on the repo (idempotent). */
async function ensureLabels(token) {
  for (const name of Object.values(LABELS)) {
    try {
      await postJson(LABELS_API, { name, color: name === "bug" ? "d73a4a" : "a2eeef" }, token);
    } catch (error) {
      // 422 = already exists — fine
      if (!String(error.message).includes("422")) console.warn("feedback: label create failed", name, error.message);
    }
  }
}

/**
 * GitHub OAuth device flow. While the Doctor authorizes in the browser, the
 * `onCode` callback receives { userCode, verificationUri } so the window can
 * display it. Returns the access token.
 */
async function deviceLogin(onCode) {
  const codeRes = await net.fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${GITHUB_CLIENT_ID}&scope=public_repo`
  });
  if (!codeRes.ok) throw new Error(`device code HTTP ${codeRes.status}`);
  const flow = await codeRes.json();
  onCode?.({
    userCode: String(flow.user_code || ""),
    verificationUri: String(flow.verification_uri || "https://github.com/login/device"),
    expiresIn: Number(flow.expires_in || 900)
  });
  shell.openExternal(flow.verification_uri || "https://github.com/login/device");
  const interval = Math.max(5, Number(flow.interval) || 5);
  const deadline = Date.now() + (Number(flow.expires_in) || 900) * 1000;
  const tokenBody = `client_id=${GITHUB_CLIENT_ID}&device_code=${encodeURIComponent(flow.device_code)}&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code`;
  for (;;) {
    if (Date.now() > deadline) throw new Error("授权超时，请重试");
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    const res = await net.fetch(TOKEN_URL, {
      method: "POST",
      headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody
    });
    const j = await res.json().catch(() => ({}));
    if (j.access_token) return String(j.access_token);
    if (j.error === "authorization_pending" || j.error === "slow_down") continue;
    throw new Error(j.error_description || j.error || "授权失败");
  }
}

function cachedToken() {
  return String(settings.get("feedbackGithubToken") || "").trim() || null;
}

function saveToken(token) {
  settings.set({ feedbackGithubToken: token });
}

function clearToken() {
  settings.set({ feedbackGithubToken: "" });
}

/** Collect a short system-info block appended to every issue body. */
function systemInfo() {
  const { app } = require("electron");
  const lines = [
    `- 应用版本：${app.getVersion()}`,
    `- 平台：${process.platform} ${process.arch}`,
    `- 系统：${process.getSystemVersion ? process.getSystemVersion() : ""}`
  ];
  return lines.join("\n");
}

function prefillUrl(type, title, body) {
  const label = LABELS[type] || "bug";
  const full = `${body}\n\n---\n${systemInfo()}`;
  const u = new URL(`https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`);
  u.searchParams.set("title", `[${label}] ${title}`);
  u.searchParams.set("labels", label);
  u.searchParams.set("body", full);
  return u.toString();
}

/**
 * Submit feedback as a GitHub issue.
 * @returns {Promise<{ok:true,url:string,number:number}|{ok:false,error:string,prefill:string}>}
 */
async function submit({ type, title, body, onCode }) {
  const label = LABELS[type] || "bug";
  const cleanTitle = String(title || "").trim().slice(0, 200) || (label === "bug" ? "Bug 报告" : "功能建议");
  const fullBody = `${String(body || "").trim()}\n\n---\n${systemInfo()}`;
  try {
    let token = cachedToken();
    if (!token) {
      token = await deviceLogin(onCode);
      saveToken(token);
    }
    await ensureLabels(token);
    const issue = await postJson(
      ISSUES_API,
      { title: `[${label}] ${cleanTitle}`, body: fullBody, labels: [label] },
      token
    );
    return { ok: true, url: String(issue.html_url || ""), number: Number(issue.number || 0) };
  } catch (error) {
    console.warn("feedback: submit failed", error.message);
    return { ok: false, error: error.message, prefill: prefillUrl(type, cleanTitle, fullBody) };
  }
}

module.exports = { submit, prefillUrl, systemInfo, deviceLogin, cachedToken, clearToken, LABELS };
