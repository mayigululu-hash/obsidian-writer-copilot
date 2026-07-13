# Writer Copilot

[简体中文](./README.zh-CN.md)

**Write with your knowledge.**

Writer Copilot is an open-source AI writing copilot for knowledge workers, built natively for Obsidian. It helps you discuss ideas with your notes, rewrite text in place, continue a paragraph, and keep writing conversations inside your vault workflow.

> Current release: **0.1.3 public beta**. Desktop only. Writer Copilot does not require OpenCode or a separate local server.

## Why Writer Copilot

Most AI chat tools sit outside your knowledge base. Writer Copilot keeps the active note, selected text, current paragraph, and explicitly attached notes close to the writing task.

- **Sidebar chat** with streaming responses, local history, session switching, rename, search, stop, copy, and insert-at-cursor.
- **Explicit context** from the active note, selection, paragraph, or multiple Markdown notes.
- **Inline writing actions** for rewrite, shorten, proofread, expand, strengthen, add examples, restructure, and continue writing.
- **Custom actions** that can be created, edited, disabled, reordered, or deleted.
- **Slash writing menu** on an empty line for continuation workflows.
- **Configurable agents** with a name, default model, description, and system instruction.
- **Bring your own model** through OpenAI-compatible APIs, Anthropic, or Google Gemini.
- **Safe write-back**: generated text is previewed first and is only applied after confirmation.
- **Local session storage** and API keys stored through Obsidian SecretStorage.

## Installation

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/mayigululu-hash/obsidian-writer-copilot/releases/latest).
2. Create `<your-vault>/.obsidian/plugins/writer-copilot/`.
3. Copy the three files into that directory.
4. Reload Obsidian and enable **Writer Copilot** under Community plugins.

### BRAT

Install the BRAT plugin, choose **Add Beta plugin**, and enter:

```text
https://github.com/mayigululu-hash/obsidian-writer-copilot
```

Writer Copilot has not yet been submitted to the official Obsidian Community plugins directory.

## Setup

1. Open **Settings → Writer Copilot → Models**.
2. Add an OpenAI-compatible, Anthropic, or Google Gemini provider.
3. Store the API key and sync or manually add model IDs.
4. Select default chat and inline-writing models.
5. Open the Writer Copilot sidebar from the ribbon.

Local OpenAI-compatible services such as Ollama or LM Studio can be configured with their local base URL and may not require an API key.

## Writing workflow

- Attach the current note or other notes in the sidebar and ask questions grounded in that context.
- Select text and run **Writer Copilot: Rewrite selected text** from the command palette or context menu.
- Type `/` on an empty line to open continuation actions.
- Review the generated result before replacing or inserting text.
- Create specialized agents for drafting, editing, reviewing, or other writing roles.

## Privacy and safety

- Provider requests are sent directly from Obsidian to the model endpoint you configure.
- API keys are stored through Obsidian SecretStorage and are not written to `data.json` or session files.
- Chat sessions are stored locally inside the plugin directory.
- Notes are sent only when you explicitly attach them or enable the active-note default.
- Writer Copilot does not start or connect to OpenCode.
- Inline output filters common reasoning containers and rejects unsafe or invalid write-back results.

See [Privacy and security](./docs/PRIVACY.md) for the complete boundary.

## Current limitations

- Desktop-only because the current implementation uses desktop Obsidian APIs.
- No vault-wide retrieval or background indexing.
- Skills, MCP runtime, tool calling, and autonomous multi-step agent execution are roadmap items, not part of 0.1.3.
- Anthropic and Gemini protocol adapters are covered by automated tests but still need broader real-account integration testing.

## Development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm test
npm run build
```

For development watch mode:

```bash
npm run dev
```

The production build writes `main.js` at the repository root. Release tags must match the version in `manifest.json` exactly, without a `v` prefix.

## Documentation

- [Product definition](./docs/PRODUCT.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Privacy and security](./docs/PRIVACY.md)
- [Roadmap](./docs/ROADMAP.md)
- [Release process](./docs/RELEASE.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)

## License

[MIT](./LICENSE)
