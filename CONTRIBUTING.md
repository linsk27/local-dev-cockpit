# Contributing

Dev Cockpit focuses on one job: restoring the local development state for personal projects.

Before adding a feature, check whether it makes the first-run or daily local workflow simpler. Avoid cloud accounts, team permissions, remote code upload, and heavy background services in the core product.

## Development

```bash
pnpm install
pnpm build
pnpm --filter local-dev-cockpit dev
```

The local panel opens at:

```txt
http://localhost:8787
```

## Checks

Run the full verification before opening a pull request:

```bash
pnpm release:check
```

For focused work:

```bash
pnpm --filter @local-dev-cockpit/core test
pnpm --filter @local-dev-cockpit/server test
pnpm --filter @local-dev-cockpit/web test
```

## Design Rules

- Keep the default workflow local-first and private.
- Do not add network calls for project analysis unless the user explicitly enables them.
- Prefer deterministic scanning and clear explanations over opaque scoring.
- Keep command execution as `command + args`; do not build shell strings.
- Add tests for scanner rules, process lifecycle, port detection, and user-visible state decisions.

## Useful Areas

- More project detectors and command inference.
- Better stale port cleanup explanations across Windows, macOS, and Linux.
- First-run examples and fixture projects.
- Desktop packaging through Electron or Tauri after the Web + CLI flow is stable.
