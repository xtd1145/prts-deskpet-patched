## PRTS 桌宠 v0.8.8

### 新增：DeepSeek 后端支持非官方 API（自定义 Base URL）

托盘「DeepSeek 设置…」新增 **API 地址** 一栏：

- 留空 = 官方 `https://api.deepseek.com`
- 也可填任意 OpenAI 兼容网关：one-api / new-api 等中转站、SiliconFlow、OpenRouter、火山方舟，或本机 Ollama / LM Studio / vLLM
- 地址可写域名根、`…/v1`、`…/api/v3` 或完整的 `…/v1/chat/completions`，程序会自动补全请求路径
- 「测试连接」依次尝试 `…/v1/models` 与 `…/models`，列出该地址下的模型供下拉选择
- 本机服务不需要 Key 时可留空：`127.0.0.1` / `localhost` / `[::1]` 会被识别为免 Key 的本地网关

### 其它

- 设置项 `deepseekBaseUrl` 只保存在本机 `settings.json`，密钥只发送给你填写的那个地址
- 补丁脚本新增 `--only=12` / `--skip-missing`：应用更新后可按需只重放本项补丁，不覆盖新版里其它改过的文件
- 新增 `build/release/publish-github-release.js`：本地构建后一键创建 Release 并上传安装包与 `latest.yml`

### 修复（2026-10-08 重新构建 macOS 资产）

- **macOS 一键安装包此前会安装失败**（`PKInstallErrorDomain Code=112：运行 PRTS-Installer-v0.8.8-mac.pkg 的脚本时出错`）：`dsh-pkg` 的 `postinstall` 里有一行把 `/usr/local/share/prts/install-dsh.sh` 复制到它自己，macOS 的 `cp` 因此返回非 0，配合 `set -e` 中止了整个安装。该行已删除。
- `distribution.xml` 里 choice 的 `selected="YES"` 不是合法布尔值，会让 Installer 的 JS 引擎报 `Can't find variable: YES`，已改为 `selected="true"`。
- 本 Release 中的 `PRTS-Installer-v0.8.8-mac.pkg` / `.dmg` / `-mac.zip` / `latest-mac.yml` 均已重新构建上传；**请使用重新构建后的文件**，此前下载的那份会在「DeepSeek Harness」组件处安装失败。

**Windows**：下载 `PRTS-Installer-v0.8.8-patched.exe` 安装（安装过程中可选择一并安装 DeepSeek Harness）。
**macOS**：下载 `PRTS-Installer-v0.8.8-mac.pkg`（一键安装，可勾选 DeepSeek Harness），或 `PRTS-0.8.8-universal.dmg`。
