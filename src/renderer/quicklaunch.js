// 快捷启动管理 window: edit the quickLaunch list, add entries, launch.
const $ = (id) => document.getElementById(id);
const listEl = $("list");
const knownEl = $("knownApps");
const statusEl = $("status");

function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = kind || "";
}

let entries = [];

function render() {
  listEl.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "row";
    empty.textContent = "（暂无条目，点下方「添加」或右上角已知应用按钮）";
    listEl.appendChild(empty);
    return;
  }
  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "row";

    const nameBox = document.createElement("div");
    nameBox.className = "fld";
    const nameInput = document.createElement("input");
    nameInput.value = entry.name;
    nameInput.placeholder = "名称";
    nameInput.spellcheck = false;
    nameInput.addEventListener("change", () => { entries[index].name = nameInput.value; save(); });
    nameBox.appendChild(nameInput);

    const pathBox = document.createElement("div");
    pathBox.className = "fld wide";
    const pathInput = document.createElement("input");
    pathInput.value = entry.path;
    pathInput.placeholder = "程序路径";
    pathInput.spellcheck = false;
    pathInput.addEventListener("change", () => { entries[index].path = pathInput.value; save(); });
    pathBox.appendChild(pathInput);

    const argsBox = document.createElement("div");
    argsBox.className = "fld";
    const argsInput = document.createElement("input");
    argsInput.value = entry.args || "";
    argsInput.placeholder = "参数(可选)";
    argsInput.spellcheck = false;
    argsInput.addEventListener("change", () => { entries[index].args = argsInput.value; save(); });
    argsBox.appendChild(argsInput);

    const actions = document.createElement("div");
    actions.className = "actions";
    const launchBtn = document.createElement("button");
    launchBtn.className = "small primary";
    launchBtn.textContent = "启动";
    launchBtn.addEventListener("click", async () => {
      setStatus("");
      const r = await window.quicklaunchApi.launch(entries[index]);
      setStatus(r.ok ? `已启动 ${entries[index].name}` : r.error, r.ok ? "ok" : "err");
    });
    const rmBtn = document.createElement("button");
    rmBtn.className = "small danger";
    rmBtn.textContent = "移除";
    rmBtn.addEventListener("click", () => {
      entries.splice(index, 1);
      save();
      render();
    });
    actions.append(launchBtn, rmBtn);

    row.append(nameBox, pathBox, argsBox, actions);
    listEl.appendChild(row);
  });
}

async function save() {
  const saved = await window.quicklaunchApi.save(entries);
  entries = saved;
  setStatus("已保存", "ok");
}

async function init() {
  entries = await window.quicklaunchApi.list();
  render();
  const known = await window.quicklaunchApi.known();
  knownEl.replaceChildren();
  for (const app of known) {
    const btn = document.createElement("button");
    btn.className = "small";
    btn.textContent = `＋${app.name}${app.path ? "" : "（未找到）"}`;
    btn.title = app.path || "未检测到安装路径，请手动填写";
    btn.addEventListener("click", () => {
      if (entries.some((e) => e.id === app.id)) { setStatus(`${app.name} 已在列表中`, "err"); return; }
      entries.push({ id: app.id, name: app.name, path: app.path, args: "" });
      save();
      render();
    });
    knownEl.appendChild(btn);
  }
}

$("addBtn").addEventListener("click", () => {
  const name = $("newName").value.trim();
  const path = $("newPath").value.trim();
  if (!name || !path) { setStatus("请填写名称与程序路径", "err"); return; }
  entries.push({ id: "", name, path, args: "" });
  save();
  render();
  $("newName").value = "";
  $("newPath").value = "";
});

$("browseBtn").addEventListener("click", async () => {
  const picked = await window.quicklaunchApi.pick();
  if (picked) $("newPath").value = picked;
});

init();
