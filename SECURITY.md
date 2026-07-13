# Security Policy

## Supported version

Only the latest public release, currently **0.1.3**, receives security fixes.

## Reporting a vulnerability

Please use GitHub's private **Report a vulnerability** flow under the repository Security tab. Do not open a public issue for credential exposure, arbitrary file modification, request interception, or unsafe write-back vulnerabilities.

Include:

- affected version;
- reproduction steps using non-sensitive test data;
- expected and actual behavior;
- potential impact;
- any suggested mitigation.

Never include real API keys, private vault content, session files, or personal filesystem paths.

## Security boundaries

- Provider credentials belong in Obsidian SecretStorage.
- Writer Copilot sends requests only to endpoints configured by the user.
- Inline generations require explicit confirmation before write-back.
- Skills, MCP tools, and autonomous tool execution are not present in 0.1.3.
