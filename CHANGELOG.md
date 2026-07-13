# Changelog

All notable public changes to Writer Copilot are documented here.

## 0.1.3 — 2026-07-13

First public beta and the only supported release line.

### Added

- Native Obsidian sidebar chat with streaming output and local session history.
- Explicit context from the active note, selection, paragraph, and attached Markdown notes.
- OpenAI-compatible, Anthropic, and Google Gemini provider adapters.
- Per-session model selection and configurable agent profiles.
- Inline writing preview with safe replace and insert operations.
- Configurable writing actions and an empty-line slash menu.
- Obsidian SecretStorage integration for provider credentials.

### Safety

- No OpenCode process, port, session, or configuration dependency.
- Inline reasoning containers are filtered before preview and write-back.
- Editor snapshots prevent applying a result after the selection or cursor has changed.

### Known limitations

- Desktop only.
- No vault-wide retrieval, Skill runtime, MCP runtime, tool calling, or autonomous multi-step execution.
