# Release process

Writer Copilot follows Obsidian's release layout. The Git tag must match `manifest.json` exactly and must not use a `v` prefix.

## Prepare

1. Update `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`.
2. Update `CHANGELOG.md`.
3. Run:

```bash
npm ci
npm run release:check
```

4. Confirm no credentials, local plugin data, sessions, backups, or private filesystem paths are tracked.

## Publish

1. Commit and push the release source.
2. Create a GitHub release whose tag equals the manifest version.
3. Upload these assets:

```text
main.js
manifest.json
styles.css
```

## Verify

- Download the release assets into a clean test vault.
- Enable the plugin and confirm the displayed version.
- Test model setup, one chat request, one inline action, and local session restoration.
