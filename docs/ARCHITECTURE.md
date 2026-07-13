# Architecture

Writer Copilot is a desktop Obsidian plugin. The basic generation path runs entirely inside the plugin and calls user-configured model providers directly.

```text
Obsidian UI
  ├─ Sidebar chat
  ├─ Settings
  └─ Inline writing preview
          │
          ▼
Generation coordination
  ├─ Context service
  ├─ Agent profile resolution
  ├─ Session store
  └─ Editor snapshot guard
          │
          ▼
Model gateway
  ├─ OpenAI-compatible
  ├─ Anthropic
  └─ Google Gemini
```

## Modules

- `src/ai/` — provider requests, streaming, and model discovery.
- `src/agents/` — agent-profile validation and resolution.
- `src/context/` — bounded prompt context from notes and editor state.
- `src/editor/` — editor snapshots and safe write-back.
- `src/sessions/` — local session persistence.
- `src/ui/` — sidebar, settings, note picker, and inline preview.
- `src/writing/` — action registry, slash triggers, and output guards.

## Persistence

- `data.json` stores non-secret plugin settings and per-vault UI state.
- `sessions/<session-id>.json` stores local conversation history.
- API keys are referenced by secret IDs and stored through Obsidian SecretStorage.

Neither `data.json` nor `sessions/` belongs in source control.

## Model resolution

For chat, model priority is:

```text
session manual model → agent default model → global chat model → first enabled model
```

Inline writing uses its configured model and falls back to the global chat model.

## Safety boundaries

- The base chat and inline paths do not require an Agent runtime.
- Agent profiles in 0.1.3 contain configuration, not autonomous tool execution.
- Inline generations are cleaned and validated before preview.
- Write-back is rejected if the editor snapshot no longer matches.
- Optional future runtimes must fail independently from basic generation.
