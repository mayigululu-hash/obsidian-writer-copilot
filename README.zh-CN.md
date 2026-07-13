# Writer Copilot

[English](./README.md)

**用你的知识库，把文章写出来。**

Writer Copilot 是一个面向知识工作者的 Obsidian 原生开源 AI 写作副驾。它让你基于自己的笔记进行讨论，在文章中直接改写、压缩和续写，并把写作会话保留在知识库工作流中。

> 当前版本：**0.1.3 公测版**。仅支持桌面端。

## 为什么做 Writer Copilot

多数 AI 对话工具位于知识库之外。Writer Copilot 把当前笔记、选中文字、当前段落和用户明确添加的其他笔记带入写作任务，让 AI 使用你的知识，而不是脱离上下文生成通用答案。

- **侧边栏聊天**：流式响应、停止生成、本地会话记录、搜索、切换、重命名、复制和插入光标。
- **明确的上下文控制**：当前笔记、选区、段落和多篇 Markdown 笔记。
- **文中写作动作**：自然改写、压缩重复、修正语病、扩写、加强论证、增加案例、调整结构和续写。
- **自定义动作**：新增、编辑、停用、上下排序和删除。
- **空白行 `/` 菜单**：快速调用续写动作。
- **可配置 Agent**：名称、说明、默认模型和系统指令。
- **自带模型配置**：支持 OpenAI 兼容接口、Anthropic 和 Google Gemini。
- **安全写回**：先预览，只有确认后才替换或插入正文。
- **本地会话与密钥隔离**：会话保存在插件目录，API Key 使用 Obsidian SecretStorage。

## 安装

### 手动安装

1. 从 [最新 Release](https://github.com/mayigululu-hash/obsidian-writer-copilot/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 创建 `<你的知识库>/.obsidian/plugins/writer-copilot/`。
3. 把三个文件复制到该目录。
4. 重新加载 Obsidian，在“第三方插件”中启用 **Writer Copilot**。

### BRAT 安装

安装 BRAT 插件，选择 **Add Beta plugin**，填入：

```text
https://github.com/mayigululu-hash/obsidian-writer-copilot
```

Writer Copilot 尚未提交到 Obsidian 官方社区插件目录。

## 配置

1. 打开“设置 → Writer Copilot → 模型”。
2. 添加 OpenAI 兼容、Anthropic 或 Google Gemini 服务。
3. 保存 API Key，并从接口同步或手动添加模型 ID。
4. 选择默认聊天模型和文中写作模型。
5. 点击功能区图标打开 Writer Copilot 侧边栏。

Ollama、LM Studio 等本地 OpenAI 兼容服务可以填写本地地址，服务不要求鉴权时可以不填 API Key。

## 写作方式

- 在侧边栏添加当前笔记或其他笔记，基于这些内容讨论和写作。
- 选中文字后，通过命令面板或右键菜单运行 Writer Copilot 写作动作。
- 在空白行输入 `/`，选择续写动作。
- 在预览中检查结果，再决定替换原文或插入正文。
- 创建不同 Agent，分别用于起草、润色、审稿或其他写作任务。

## 隐私与安全

- 模型请求由 Obsidian 直接发送到你配置的 Provider。
- API Key 通过 Obsidian SecretStorage 保存，不进入 `data.json` 或会话文件。
- 会话记录保存在本地插件目录。
- 只有明确添加的笔记，或开启默认附加的当前笔记，才会进入模型请求。
- 插件不会启动、连接或读取 OpenCode。
- 文中写作会过滤常见推理标签，不合格结果不会写回正文。

完整边界见[隐私与安全说明](./docs/PRIVACY.md)。

## 当前限制

- 当前只支持 Obsidian 桌面端。
- 暂无整库检索、后台索引和自动召回。
- Skill、MCP Runtime、工具调用和自主多步 Agent 不属于 0.1.3。
- Anthropic 和 Gemini 已有协议自动测试，但仍需要更多真实账号集成验证。

## 本地开发

需要 Node.js 22+ 和 npm。

```bash
npm install
npm test
npm run build
```

开发监听：

```bash
npm run dev
```

生产构建会在仓库根目录生成 `main.js`。Release Tag 必须与 `manifest.json` 中的版本完全一致，不使用 `v` 前缀。

## 文档

- [产品定义](./docs/PRODUCT.md)
- [技术架构](./docs/ARCHITECTURE.md)
- [隐私与安全](./docs/PRIVACY.md)
- [路线图](./docs/ROADMAP.md)
- [发布流程](./docs/RELEASE.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)

## 许可证

[MIT](./LICENSE)
