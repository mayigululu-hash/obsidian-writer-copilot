# Privacy and security

Writer Copilot is local-first in storage, but model inference may be remote depending on the provider you configure.

## What stays local

- plugin settings that do not contain provider credentials;
- agent profiles and writing actions;
- chat sessions;
- draft input and per-vault UI state.

## What may leave the device

When you generate text, Writer Copilot sends the request to the configured provider endpoint. A request can include:

- your prompt;
- active-note content when default attachment is enabled;
- selected text or the current paragraph;
- other notes you explicitly attach;
- relevant system and agent instructions.

The provider's own privacy and retention policy applies to those requests.

## Credentials

API keys are stored through Obsidian SecretStorage. Plugin settings contain only a secret reference ID. Credentials must never be committed to Git, copied into bug reports, or placed in agent instructions.

## Write-back protection

- Generated content is displayed in a preview.
- Replacing or inserting text requires an explicit user action.
- The plugin checks the file, selection, and cursor snapshot before applying a result.
- Invalid output and common internal reasoning containers are rejected or removed.

## Network boundary

Writer Copilot does not start a local server and does not connect to OpenCode. It communicates only with model endpoints configured by the user.

## Not implemented in 0.1.3

There is no Skill runtime, MCP runtime, external tool execution, environment-variable injection, vault-wide index, or autonomous Agent loop.
