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

**Windows**：下载 `PRTS-Installer-v0.8.8-patched.exe` 安装（安装过程中可选择一并安装 DeepSeek Harness）。
