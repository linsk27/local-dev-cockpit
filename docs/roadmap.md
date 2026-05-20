# Roadmap

Dev Cockpit is currently a 0.1 MVP. The goal is to make local project recovery obvious, stable, and lightweight before adding larger platform features.

## 0.1 MVP

- Local Vue 3 dashboard launched by `npx local-dev-cockpit`.
- Electron desktop shell with a Windows Setup installer and portable exe.
- Project root management.
- Node, Python, Java, PHP, Ruby, .NET, Go, Rust, Docker, and mixed project detection.
- Python project-level binding, `.vscode` interpreter, `.venv`/`venv`, Conda, inherited terminal Conda/venv, uv, Poetry, and Pipenv environment resolution before command launch.
- Java Maven/Gradle wrapper detection with Spring Boot run commands.
- Git branch, dirty count, command inference, ports, logs, and AI context.
- Managed process start/stop.
- External service detection with HTTP reachability checks.
- Stale port detection for occupied but unreachable local endpoints.
- Multilingual UI, themes, accent colors, and low-overhead polling.
- Settings-based update check with GitHub Release first, npm registry fallback, and top-left update indicator for new releases.

## 0.2 Reliability

- Better macOS and Linux external process attribution.
- More accurate Python backend entry detection and environment diagnostics.
- Broader framework presets for monorepo task runners, PHP variants, Ruby variants, and additional JVM frameworks.
- Safer cleanup flows for orphaned process trees.
- More fixture projects and browser-based regression checks.
- Clearer error recovery for missing package managers and virtual environments.

## 0.3 Packaging

- Add signed release artifacts and optional in-app background updater.
- Harden the Electron shell or evaluate Tauri after the Web + CLI flow is stable.
- Add import/export for local workspace configuration.

## Later

- Optional AI summaries through user-configured providers.
- Optional plugin system for custom detectors.
- Optional SQLite storage if JSON state becomes limiting.

## Non-goals

- Replacing IDE project management.
- Cloud sync, accounts, or team permissions in the core MVP.
- Uploading source code for analysis by default.
- CI/CD, deployment monitoring, or production observability.
