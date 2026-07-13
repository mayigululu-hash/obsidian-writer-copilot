# Roadmap

The roadmap is directional. A capability enters a release only after its product behavior, permissions, failure isolation, and tests are defined.

## Current: 0.1.3

- native sidebar chat;
- local session history;
- explicit note context;
- direct model providers;
- configurable agent profiles;
- configurable inline writing actions;
- slash continuation and safe write-back.

## Next

- improve first-run model setup and diagnostics;
- add broader provider integration tests;
- improve session indexing and corrupted-session isolation;
- refine inline writing quality and action templates;
- prepare official Obsidian Community plugin submission.

## Later

- Skill registry for reusable writing methods;
- MCP runtime with explicit permissions and secret isolation;
- capability binding per agent;
- observable tool calls and user confirmation;
- optional retrieval design for larger knowledge bases;
- carefully bounded multi-step agent execution.

Basic chat and inline writing must remain usable when any later capability is disabled or fails.
