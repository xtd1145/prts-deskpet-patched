# PRTS 桌宠 · 完整版（含 DeepSeek Harness 集成补丁）

> 基于 [SVAH-X/claude-code-but-priestess](https://github.com/SVAH-X/claude-code-but-priestess) v0.7.6
> 的本地完整版。原作者与画师版权见 `LICENSE`（PolyForm-Noncommercial-1.0.0）与 app 内「制作者名单」。

本仓库包含应用完整源码（`src/`、`assets/`）+ 我们打的所有补丁（`patches/`），以及一个可直接运行的完整版便携包（见 GitHub Releases）。

## 相对原版的 8 项补丁

1. **开机自启动** — 托盘新增「开机自启动」开关，通过 `app.setLoginItemSettings` 写 Windows Run 键（`src/main/main.js` 的 `applyAutoLaunch`）。
2. **DSH 控制插件** — 新增 `src/main/dsh-control.js`：管理 127.0.0.1:3080 的 DeepSeek Harness 服务（启动/停止/状态探测）+ 最小 RPC 客户端（`session.list / prompt / cancel / host.describe`）；托盘新增 "DeepSeek Harness" 区块；独立「DSH 控制台」窗口（`src/renderer/dsh-control.html/.js`）。
3. **弹出窗模式切换（对话 / 控制 · DSH）** — 点击桌宠打开的对话框顶部新增模式页签；「控制」模式内嵌 DSH 控制面板并在进入时唤醒服务（`src/renderer/dsh-control-inline.js`）。
4. **内置后端 404 修复** — `src/main/priestess-provider.js` 对 Anthropic 风格 base URL（`…/anthropic`）做归一化；配套设置：`priestessBaseUrl=https://api.deepseek.com/v1`、`priestessModel=deepseek-chat`。
5. **桌宠窗口行为插件** — 托盘新增「固定在前台」（`setAlwaysOnTop`，screen-saver 层级）与「鼠标穿透」（`setIgnoreMouseEvents`，点击穿透、悬停仍转发）两个开关，设置持久化，创建窗口时自动应用。
6. **桌宠界面鼠标穿透开关** — 桌宠右上角新增纯图标按钮，直接在桌宠上切换鼠标穿透（开启时通过"可交互小区域"技巧保持按钮本身可点，文字说明在托盘）。
7. **数据目录继承** — `src/main/main.js` 顶部将 `userData` 固定到 `%APPDATA%\claude-code-but-priestess`，安装版可直接继承原版配置/人设/记忆/对话。
8. **自动更新** — 更新源指向本仓库（`xtd1145/prts-deskpet-patched`）：Windows 走 electron-updater + NSIS，启动后自动检查、由用户决定下载安装（托盘可手动检查/下载）；`electron-builder.yml` 已配好 `publish`（GitHub provider）。

## 目录

```
src/       应用源码（已含全部补丁）
assets/    角色立绘资源
patches/   补丁工具：
  asar-dump.js          asar 解包器
  asar-pack.js          asar 打包器
  prts-reapply-patch.js 更新后一键重放补丁（node patches/prts-reapply-patch.js --install）
package.json
```

## 运行 / 打包

- **直接运行**：下载 Releases 里的便携包（zip），解压后运行 `PRTS.exe` 即可（无需安装）。
- **从源码构建**：`npm install` 后 `npm start`（需 Electron；本仓库未包含 node_modules）。
- **应用更新后重打补丁**：更新会覆盖 `app.asar`，用
  `node patches/prts-reapply-patch.js --install`
  一键重放全部补丁（需在安装目录所在机器的 node 环境执行）。

## 隐私说明

本仓库与便携包**不包含**任何个人数据（settings.json、API Key、会话记录、记忆文件均在用户本机数据目录，不上传）。

## 许可

PolyForm-Noncommercial-1.0.0（非商业使用），角色美术版权归原作者/画师所有，详见 app 内「制作者名单」。
