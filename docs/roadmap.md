# Roadmap

Dev Cockpit is currently a 0.1 MVP. The goal is to make local project recovery obvious, stable, and lightweight before adding larger platform features.

## 0.1 MVP

- Local Vue 3 dashboard launched by `npx local-dev-cockpit`.
- Electron desktop shell with a Windows Setup installer and portable exe.
- Project root management.
- Node, Python, Java, PHP, Ruby, .NET, Go, Rust, Docker, and mixed project detection.
- Node workspace root detection for pnpm workspaces, Turbo, Nx, Lerna, and Rush without blocking child app discovery.
- Python project-level binding, `.vscode` interpreter, `.venv`/`venv`, Conda, inherited terminal Conda/venv, uv, Poetry, and Pipenv environment resolution before command launch.
- Java Maven/Gradle wrapper detection with Spring Boot run commands.
- Git branch, dirty count, command inference, ports, logs, and AI context.
- Managed process start/stop.
- External service detection with HTTP reachability checks.
- Stale port detection for occupied but unreachable local endpoints.
- Multilingual UI, themes, accent colors, and low-overhead polling.
- Settings-based update check with GitHub Release first, npm registry fallback, and top-left update indicator for new releases.

## 0.2 Stable Core

This milestone is about making the existing two-section app dependable. The sidebar intentionally stays limited to Projects and Settings until project recovery is boringly reliable.

- Better macOS and Linux external process attribution.
- More accurate Python backend entry detection and environment diagnostics.
- Broader framework presets for monorepo task runners, PHP variants, Ruby variants, and additional JVM frameworks.
- Safer cleanup flows for orphaned process trees.
- More fixture projects and browser-based regression checks.
- Clearer error recovery for missing package managers and virtual environments.
- No new sidebar modules unless they directly improve project recovery, settings, or diagnostics.
- Keep commands, logs, ports, Git state, diagnostics, and AI context inside the project detail tabs instead of adding separate navigation entries.

## 0.3 Packaging

- Add signed release artifacts and optional in-app background updater.
- Harden the Electron shell or evaluate Tauri after the Web + CLI flow is stable.
- Add import/export for local workspace configuration.

## Later Modules

New modules should be added only after the stable core has enough real-user coverage. Candidate modules:

- Optional AI summaries through user-configured providers.
- Optional plugin system for custom detectors.
- Optional SQLite storage if JSON state becomes limiting.
- Task recipes for repeatable multi-command startup flows.
- Local dependency health overview for projects that opt in.

## Non-goals

- Replacing IDE project management.
- Cloud sync, accounts, or team permissions in the core MVP.
- Uploading source code for analysis by default.
- CI/CD, deployment monitoring, or production observability.
