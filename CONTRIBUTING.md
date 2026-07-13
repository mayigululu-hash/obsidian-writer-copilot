# Contributing to Writer Copilot

Thanks for helping improve Writer Copilot.

## Before you start

- Search existing issues before opening a new one.
- Use a focused issue for behavior changes or new features.
- Never include real API keys, private notes, session files, or vault paths in an issue or pull request.

## Development setup

Requirements: Node.js 22+ and npm.

```bash
git clone https://github.com/mayigululu-hash/obsidian-writer-copilot.git
cd obsidian-writer-copilot
npm install
npm test
npm run build
```

For watch mode:

```bash
npm run dev
```

Copy `main.js`, `manifest.json`, and `styles.css` into a test vault under `.obsidian/plugins/writer-copilot/`, then reload Obsidian.

## Pull requests

- Keep changes scoped and explain the user impact.
- Add or update tests for behavior changes.
- Run `npm run release:check` before submitting.
- Do not commit `main.js`, `node_modules`, backups, local plugin data, sessions, or `.env` files.
- Preserve the rule that basic chat and inline writing must not depend on Agent, Skill, MCP, or tool runtimes.

## Architecture principles

- Provider failures must not corrupt sessions or editor content.
- Generated text must be previewed before write-back.
- Secrets must remain in Obsidian SecretStorage.
- Context should be explicit and bounded.
- Optional advanced runtimes must not block basic writing features.
