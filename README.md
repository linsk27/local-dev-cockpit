# Dev Cockpit

Dev Cockpit 是一个本地开发工作台：把你电脑里的项目、启动命令、Git 状态、端口、日志和 AI 上下文放到同一个面板里，减少“这个项目怎么跑起来”的重复成本。

```bash
npx local-dev-cockpit
```

默认打开：

```txt
http://localhost:8787
```

![Dev Cockpit Dashboard](docs/assets/dashboard.png)

真实扫描 `D:\个人` 后，可以同时看到多个项目和正在运行的端口：

![Dev Cockpit Multi Project Dashboard](docs/assets/dashboard-multi-project.png)

主题、强调色和语言可在设置页直接切换：

![Dev Cockpit Appearance Settings](docs/assets/settings-themes.png)

## 它解决什么问题

个人开发和 AI 编程的真实痛点不是“看不到代码”，而是经常丢失开发现场：

- 忘记项目启动命令、包管理器和端口。
- 多个项目混在一起，不知道哪个在运行。
- 需要频繁复制项目背景给 Codex、Cursor、Claude。
- 上次失败日志散在终端里，第二天很难恢复状态。

Dev Cockpit 只做一件事：本地项目现场恢复。它不接云端账号，不上传代码，不强行接 AI API。

## 当前功能

- 自动扫描 Git 项目和常见技术栈项目。
- 识别 Node、Python、Go、Rust、Docker 和混合项目。
- 从 `package.json`、Flask/FastAPI/Django、Go、Cargo、Docker Compose 推断常用命令。
- 显示 Git 分支、未提交文件数、最近提交、端口状态和最近失败。
- 端口展示会保留 `localhost` / `127.0.0.1` / `::1` 这类 host，避免多个本地项目同时使用 `3000` 时看不清真实来源。
- 在线项目会自动排在列表上方，项目列表支持按名称、路径、分支、命令和端口搜索。
- 项目列表里的运行地址可以直接点击打开，减少进入详情页再找端口的步骤。
- 左侧工作栏可收缩，适合在小屏幕或并排编辑器场景下减少占用。
- 恢复卡片只展示状态和运行地址；运行/停止统一放在命令区，避免重复按钮。
- 运行命令后会自动刷新日志和运行地址；运行中的命令会变成停止按钮，其他命令暂时禁用，避免重复启动。
- 命令启动、停止、刷新和复制上下文都会给出轻量反馈，避免点击后没有响应感。
- 在面板里启动/停止命令，日志写入本地文件并实时显示。
- 一键生成 `PROJECT_CONTEXT.md` 和 `AGENTS.md` 内容，方便交给 AI coding agent。
- 支持中文/英文、多主题和多强调色，偏好保存在浏览器本地。
- 默认端口 `8787`，占用时自动尝试 `8788-8799`。

## 快速使用

```bash
pnpm install
pnpm build
pnpm --filter local-dev-cockpit dev
```

或者构建后直接运行：

```bash
node packages/cli/dist/index.js serve
```

常用命令：

```bash
# 启动 Web 面板
npx local-dev-cockpit

# 扫描指定目录
npx local-dev-cockpit scan D:\个人

# 添加项目根目录到面板
npx local-dev-cockpit add-root D:\个人

# 检查本机 Git / Node / Python / Go / Cargo
npx local-dev-cockpit doctor

# 输出某个项目的 AI 上下文
npx local-dev-cockpit context D:\个人\my-project

# 写入 PROJECT_CONTEXT.md 和 AGENTS.md
npx local-dev-cockpit context D:\个人\my-project --write
```

## 页面结构

- 项目列表：项目名、路径、技术栈、Git 分支、dirty 文件数、端口、运行状态和可点击运行地址。
- 项目详情：恢复卡片、命令区、实时日志、端口区、Git 区、AI 上下文区。
- 设置页：项目根目录、语言、主题模式和强调色。

## 本地数据

Dev Cockpit 的数据只保存在本机：

```txt
%APPDATA%\local-dev-cockpit\config.json
%APPDATA%\local-dev-cockpit\state.json
%APPDATA%\local-dev-cockpit\logs\*.log
```

默认不会写入你的项目目录。只有执行 `context --write`，才会在目标项目写入 `PROJECT_CONTEXT.md` 和 `AGENTS.md`。

## 架构

这是一个为未来 Electron/Tauri 桌面版预留的 monorepo：

```txt
packages/core    项目扫描、技术栈识别、命令推断、Git/端口状态、AI 上下文
packages/server  本地 HTTP API、WebSocket、进程生命周期和日志管理
packages/cli     npx 入口、scan/doctor/context 命令、打包 Web 资源
apps/web         Vue 3 + Vite + Pinia + Vue Router Dashboard
```

核心约束：

- `core` 不依赖 Vue、HTTP server 或 CLI。
- 命令执行使用 `command + args`，避免拼接 shell 字符串。
- API 输入用 `zod` 校验。
- 日志使用内存 ring buffer + 文件落盘，避免大日志撑爆内存。
- CLI 发布包会把 Vue 面板一起打进 `packages/cli/dist/web`，保证 `npx local-dev-cockpit` 可以独立运行。

更详细设计见 [docs/architecture.md](docs/architecture.md)。

## 当前阶段

当前是 `0.1.0` 可运行原型，重点验证方向：本地项目恢复、日志聚合、运行地址识别、AI 上下文生成和简洁面板体验。下一步会继续减少操作步骤，补充更多真实项目扫描样本、进程异常恢复、配置编辑和桌面端封装。
