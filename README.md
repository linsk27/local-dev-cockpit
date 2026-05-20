# Dev Cockpit

Dev Cockpit 是一个本地开发工作台：把你电脑里的项目、启动命令、Git 状态、端口、日志和 AI 上下文放到同一个面板里，减少“这个项目怎么跑起来”的重复成本。

> 一句话定位：给本机项目用的“开发现场恢复台”，不是 IDE、不是云平台，也不是 AI 聊天工具。

```bash
npx local-dev-cockpit
```

默认打开：

```txt
http://localhost:8787
```

首次打开时，会先看到 `Dev Pilot` 引导弹窗；选择一个本机工作区后进入项目扫描：

![Dev Cockpit First Run](docs/assets/onboarding.png)

添加根目录后，进入本地项目总览：

![Dev Cockpit Dashboard](docs/assets/dashboard.png)

真实扫描 `D:\个人` 后，可以同时看到多个项目和正在运行的端口：

![Dev Cockpit Multi Project Dashboard](docs/assets/dashboard-multi-project.png)

主题、强调色和语言可在设置页直接切换：

![Dev Cockpit Appearance Settings](docs/assets/settings-themes.png)

## 一分钟上手

1. 运行 `npx local-dev-cockpit`。
2. 打开 `http://localhost:8787`。
3. 首屏输入一个工作区目录，例如 `D:\个人` 或 `C:\Users\you\Projects`。
4. 在项目列表里选择项目，查看命令、端口、日志和 AI 上下文。
5. 点击 `dev` / `start` 启动服务，或复制上下文交给 Codex、Cursor、Claude。

默认只读取本机项目元数据，不上传代码；也不会写入项目目录，除非你显式点击“写入文件”或执行 `context --write`。

## 它解决什么问题

个人开发和 AI 编程的真实痛点不是“看不到代码”，而是经常丢失开发现场：

- 忘记项目启动命令、包管理器和端口。
- 多个项目混在一起，不知道哪个在运行。
- 需要频繁复制项目背景给 Codex、Cursor、Claude。
- 上次失败日志散在终端里，第二天很难恢复状态。

Dev Cockpit 只做一件事：本地项目现场恢复。它不接云端账号，不上传代码，不强行接 AI API。

## 适合谁

- 同时维护多个前端、后端、脚本、实验项目的个人开发者。
- 经常在 VS Code、Cursor、PowerShell、浏览器之间切换的人。
- 需要把“当前项目怎么跑、哪里报错、哪个端口在线”快速交给 AI coding agent 的人。
- 想要一个轻量本地面板，但不想接入云端账号或复杂团队系统的人。

## 不适合谁

- 只维护一个项目，并且所有命令已经固定在 IDE 里。
- 需要团队权限、云同步、线上部署监控、CI/CD 编排的场景。
- 期望它替代 VS Code、JetBrains 或 Docker Desktop。

## 当前功能

- 自动扫描 Git 项目和常见技术栈项目。
- 识别 Node、Python、Java、PHP、Ruby、.NET、Go、Rust、Docker 和混合项目。
- 从 `package.json`、Flask/FastAPI/Django、Maven/Gradle/Spring Boot、Laravel/Composer、Rails/Rack、.NET、Go、Cargo、Docker Compose 推断常用命令。
- Python 后端会识别 `app.py`、`main.py`、`app/main.py`、`src/app/main.py`、`server.py`、`api.py` 等常见入口；Flask 默认用 `python -m flask --app ... run`，FastAPI 默认用 `python -m uvicorn ...`，让启动地址更容易被浏览器访问。
- 遇到 `pnpm-workspace.yaml`、`turbo.json`、`nx.json`、`lerna.json`、`rush.json` 这类 monorepo 根目录时，会继续向 `apps`、`packages`、`services`、`frontend`、`backend` 等子目录扫描，不会只停在根目录。
- Node 项目会优先读取 `packageManager` 字段；没有声明时按 lockfile 推断，混有 `package-lock.json` 和 `yarn.lock` 时默认选择更常见且更容易可用的 npm，减少 `yarn.cmd` 缺失这类误启动。
- 显示 Git 分支、未提交文件数、最近提交、端口状态和最近失败。
- 端口展示会保留 `localhost` / `127.0.0.1` / `::1` 这类 host，避免多个本地项目同时使用 `3000` 时看不清真实来源。
- 在线项目会自动排在列表上方，项目列表支持按名称、路径、分支、命令和端口搜索；如果项目是在 VS Code 或系统终端里启动的，面板也会低频刷新并尝试识别。
- 首页按具体根目录工作，不提供“全部根目录”聚合视图，避免大工作区长期挂着时重复扫描无关项目。
- 首次启动不自动扫描当前命令目录，先让用户明确选择工作区，避免 `npx` 缓存目录或临时目录混入项目列表。
- 侧栏目前只保留“项目”和“设置”。命令、日志、端口、Git、诊断和 AI 上下文都收敛在项目详情标签页里；后续新模块会等核心恢复流程稳定后再加。
- 左侧工作栏底部用“占用低/中/高”概括服务开销，并显示内存和最近一次扫描耗时；折叠侧栏后仍保留紧凑状态指示。
- 项目列表展示项目名、技术栈、分支、路径和运行地址；运行地址可以直接点击打开。
- 项目状态会区分“托管运行”和“外部在线”：前者是 Dev Cockpit 启动并可停止的命令，后者是 VS Code/终端等外部进程已在运行。
- 概况页提供快捷操作区：打开文件夹、用配置编辑器打开项目、复制路径、复制 AI 上下文，方便快速回到本地文件。
- 左侧工作栏可收缩，适合在小屏幕或并排编辑器场景下减少占用。
- 恢复卡片只展示项目概况、状态和运行地址；运行/停止统一放在命令区，避免重复按钮。
- 项目详情采用固定高度面板，概况、命令、日志和 AI 上下文通过标签切换，避免长页面堆叠。
- 概况页内置诊断面板，把命令来源、包管理器、端口来源、最近失败和下一步操作拆开显示，减少“为什么这个项目是在线/异常”的猜测。
- 运行命令后会自动刷新日志和运行地址；运行中的命令会变成停止按钮，其他命令暂时禁用，避免重复启动。
- 如果项目已经由 VS Code/终端启动，命令区会显示“已在线”并阻止重复运行；如果端口残留但 HTTP 不通，会提示先清理端口。
- 命令区会直接标记“缺环境 / 需确认”：缺少硬运行时的命令不可点击；依赖未安装、虚拟环境不固定等风险会先提示但不强行阻断。
- 命令启动、停止、刷新和复制上下文都会给出轻量反馈，避免点击后没有响应感。
- 默认采用低消耗刷新策略：运行中项目高频刷新，全量扫描低频刷新；页面隐藏时暂停后台轮询。
- 切换根目录时会显示扫描提示和骨架列表，避免误以为页面卡死。
- 在面板里启动/停止命令，日志写入本地文件并实时显示。
- 设置页可以查看、添加和移除项目根目录，不需要手动编辑配置文件。
- AI 上下文标签支持预览、复制，也可以显式写入 `PROJECT_CONTEXT.md` 和 `AGENTS.md`，方便交给 AI coding agent。
- 支持中文/英文、多主题和多强调色，偏好保存在浏览器本地。
- 默认端口 `8787`，占用时自动尝试 `8788-8799`。

## 在线状态如何判断

Dev Cockpit 不只看自己启动的命令。总览页会定时刷新，并按可靠度从高到低判断项目是否在线：

1. 面板启动的命令仍在运行，并且日志里解析到了可访问的本地地址。
2. Windows 监听端口能反查到进程命令行，命令行里包含当前项目路径，并且该地址能通过本地 HTTP 探测访问，例如 VS Code 终端启动的 Next.js / Vite 服务。
3. 命令里明确声明了端口，例如 `--port 8000`，并且当前扫描结果里只有这个项目声明该端口。

无法归属到具体项目的公共端口，例如某个未知进程占用了 `3000`，不会直接把所有 Node 项目都标为在线。这样可以减少误判。
如果系统能看到某个项目进程监听端口，但 `127.0.0.1` / `localhost` 实际访问失败，Dev Cockpit 会把它归为“需清理”，不会再显示成“外部在线”。

状态含义：

- `托管运行`：Dev Cockpit 启动的命令仍在运行，可以从面板停止。
- `外部在线`：系统检测到该项目已有本地服务，且本地 HTTP 探测可访问；通常来自 VS Code 终端、PowerShell 或其他工具。
- `需清理`：端口被占用但 HTTP 不可访问，建议先清理端口再启动。
- `异常`：最近一次命令失败，优先看日志。

项目概况里会展示“状态依据”：它会说明当前状态来自 Dev Cockpit 托管进程、系统端口反查、上次失败日志，还是残留端口。这样看到“在线/异常/需清理”时，不需要猜测面板为什么这样判断。

清理端口是幂等操作：如果端口表里的旧 PID 已经消失，或者端口在清理过程中已经关闭，Dev Cockpit 会把它当作清理成功并刷新项目状态，而不是继续报一个无意义的失败。

诊断面板会进一步拆成五项：命令来源、包管理器、端口来源、最近失败和下一步。它不是新的操作流程，只是把判断依据翻译成用户能直接执行的提示。

## 命令启动保护

Dev Cockpit 的运行按钮不是简单调用脚本，它会先做一次轻量保护：

- 同一项目已有托管命令运行时，不再启动第二个命令。
- 项目已经检测到可访问端口时，不重复启动 `dev` / `start` 类命令，避免 Next.js、Vite、Uvicorn 报端口占用。
- 命令明确声明了端口，例如 `--port 8000`，会只按这个端口判断是否冲突。
- 端口被项目进程占用但 HTTP 不可访问时，会标记为“需清理”，要求先停止端口再启动。
- 包管理器缺失时会给出可执行建议；pnpm/yarn 会优先尝试 Corepack，必要时在存在 `package-lock.json` 的项目里回退到 npm。
- 服务端在真正启动前也会做运行环境拦截：缺少 Node、Python、Maven、Gradle、PHP、Ruby、.NET、Go、Cargo、Docker 等硬运行时时，会直接返回原因，不先启动一个必定失败的进程。

## 运行环境识别

真实项目经常不是“系统 PATH 里有一个命令就能跑”。Dev Cockpit 启动命令前会尽量自动选择项目环境，减少别人下载后因为环境不同直接失败：

- Python 命令会优先使用 `.vscode/settings.json` 中选择的 `python.defaultInterpreterPath` / `python.pythonPath`，这能覆盖 VS Code/Cursor 里选中的全局 Conda 环境。
- 然后使用当前项目里的 `.venv`、`venv`、`.env`、`env`、`.conda` 或 `conda`。
- 如果项目拆成 `frontend` / `backend`，后端目录没有虚拟环境，也会检查上一层工作区里的虚拟环境。
- 如果存在 `environment.yml` / `environment.yaml`，且本机能找到 Conda，会按里面的 `name:` 使用 `conda run -n <env> ...`。
- 如果存在 `uv.lock`、`poetry.lock` / `[tool.poetry]` 或 `Pipfile`，且本机能找到对应工具，会分别通过 `uv run python ...`、`poetry run python ...`、`pipenv run python ...` 执行。
- 如果用户是在已激活的终端里启动 Dev Cockpit，例如先 `conda activate api-env` 或激活 `.venv`，再运行 `npx local-dev-cockpit`，Dev Cockpit 会继承 `CONDA_PREFIX` / `CONDA_DEFAULT_ENV` / `VIRTUAL_ENV`，在没有更明确项目环境时用这个终端环境跑 Python 命令。
- 如果没有项目环境，会回退到系统 `python`；Windows 上找不到 `python` 时会尝试 `py` launcher。
- Java 项目会优先使用项目自带的 `mvnw` / `gradlew` wrapper；没有 wrapper 时才使用系统 `mvn` / `gradle`。无论使用 wrapper 还是系统 Maven/Gradle，启动前都会检查本机是否能找到 `java` 或有效的 `JAVA_HOME`。
- Spring Boot 项目会识别 `spring-boot:run` / `bootRun`，普通 Maven/Gradle 项目仍提供 `test` 和 `build` 命令。
- PHP 项目会识别 Laravel `artisan serve` 和常见 Composer scripts。
- Ruby 项目会识别 Rails、Rack 和 `app.rb`，优先通过 `bundle exec` 运行。
- .NET 项目会识别 `.csproj` / `.sln`，提供 `dotnet run`、`dotnet test` 和 `dotnet build`。

这部分仍然保持本地确定性规则，不会上传代码，也不会自动安装依赖。若环境本身没有创建，面板会在日志里给出原因，而不是假装已经成功启动。

项目详情的“运行环境”区域可以给 Python 项目手动绑定环境。只有在自动识别不到、桌面版无法继承终端 Conda/venv，或出现“终端能跑但面板缺包”时才需要配置；如果项目已有 `.venv`、`environment.yml`、`uv.lock`、Poetry/Pipenv 或 `.vscode/settings.json`，通常可以留空。面板会把检测到的候选环境显示成小按钮，点击即可填入；如果本机装了 Conda，也会在打开该区域时按需读取 `conda env list --json`，列出可用 Conda 解释器。填写 `conda:环境名` 会通过 `conda run -n 环境名 python ...` 运行；填写 `C:\path\to\python.exe` 或虚拟环境目录会直接使用对应解释器。保存时会做轻量校验，避免明显不存在的路径或错误格式进入配置。绑定保存在 Dev Cockpit 自己的配置文件里，不会写入用户项目。

注意：Windows 桌面双击启动的应用不能读取另一个终端窗口里 `conda activate` 后的状态，因为环境变量只会从父进程继承。别人平时用终端启动 Conda 项目时，可以从同一个已激活终端启动 `npx local-dev-cockpit`；如果用桌面安装版，可以在项目详情里手动绑定 `conda:环境名`，也可以在项目里保留 `.venv` / `.conda` / `environment.yml` / `.vscode/settings.json` 这类可发现配置。

如果 Python 项目启动后出现 `ModuleNotFoundError: No module named 'xxx'`，Dev Cockpit 会在最近失败里提取缺失模块，并提示在当前 Python 环境中运行 `python -m pip install xxx`。如果依赖已经安装过，通常说明 IDE、终端和 Dev Cockpit 使用的不是同一个 `.venv` / Conda 环境。Conda 项目优先在“运行环境”区域选择候选环境或填写 `conda:环境名`；如果习惯终端启动，可以先 `conda activate 环境名`，再从同一个终端运行 `npx local-dev-cockpit`。

如果 Node 项目出现 `Cannot find package 'xxx'`、`Cannot find module 'xxx'`，或者 `vite` / `next` / `ts-node` 这类脚本命令找不到，Dev Cockpit 会提示先执行当前包管理器的 install 命令，例如 `pnpm install` / `npm install`，再按需安装缺失依赖。相对路径模块缺失会被当成源码或构建产物问题，不会误导用户安装一个不存在的 npm 包。

如果 PHP、Ruby 或 .NET 项目绕过了启动前预检，但运行日志里出现 `vendor/autoload.php`、`Could not find gem`、`NETSDK1004` / `project.assets.json` 这类典型依赖错误，Dev Cockpit 会把最近失败摘要转成可执行建议，例如 `composer install`、`bundle install` 或 `dotnet restore`。

诊断页也会做启动前预检：Node 项目如果有 `package.json` 依赖，但当前目录和父级目录都没有 `node_modules`，会提前提示先安装依赖；monorepo 子项目会复用父级 `node_modules`，缺依赖时也会提示到工作区根目录执行 install。Python 项目如果有 `requirements.txt` / `pyproject.toml` 但没有 `.venv`、Conda、uv、Poetry 或 Pipenv 环境入口，会提示当前会回退系统 Python，避免用户点运行后才看到一长串缺包日志。Java 会提示缺少 Maven/Gradle wrapper 的可移植性风险，也会在 JDK 不可用时直接拦截并提示配置 `JAVA_HOME` 或 `java`；PHP 会识别 `composer.json` 但缺少 `vendor/autoload.php`；Ruby 会提示 `Gemfile` 缺少 `Gemfile.lock`；.NET 会提示缺少 `obj/project.assets.json` 时应先 `dotnet restore`。

## 性能策略

Dev Cockpit 可以长期挂在浏览器或桌面壳里，因此默认避免高频全盘扫描：

- 全量项目扫描按当前选择的根目录运行，并在服务端缓存短时间结果，多个页面同时打开也不会重复扫目录。
- 运行中的项目才会高频刷新日志和运行状态；空闲项目不做 2 秒级轮询。
- 浏览器标签页隐藏时暂停自动刷新，重新回到页面后再补一次轻量刷新。
- 侧栏底部性能指示每几秒读取一次轻量指标，不触发项目扫描；显示的是 Dev Cockpit 自身占用，不是项目服务占用。
- 同一次扫描里，`3000`、`5173`、`8000` 等常见端口会去重探测，避免每个项目重复检查同一端口。
- 日志只保留最近片段在内存里，完整内容写入本地日志文件。

如果根目录非常大，建议添加更具体的工作区目录，而不是直接添加整个磁盘。

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

# 检查某个项目的运行环境和推荐命令
npx local-dev-cockpit doctor D:\个人\my-project

# 输出某个项目的 AI 上下文
npx local-dev-cockpit context D:\个人\my-project

# 写入 PROJECT_CONTEXT.md 和 AGENTS.md
npx local-dev-cockpit context D:\个人\my-project --write
```

`doctor <项目路径>` 对 Python 项目会额外列出检测到的环境候选，例如 `.venv`、父级工作区虚拟环境、`.vscode/settings.json`、`environment.yml` 和本机 Conda 环境。它也会读取面板里已经保存的项目级 Python/Conda 绑定，所以终端诊断和桌面面板的启动逻辑保持一致。终端用户可以用它确认 Dev Cockpit 实际会选哪个解释器；桌面版用户可以把候选里的 `conda:环境名` 或 `python.exe` 路径填到项目详情的“运行环境”区域。

## 页面结构

- 项目列表：项目名、路径、技术栈、Git 分支、dirty 文件数、端口、运行状态和可点击运行地址。
- 项目详情：概况、命令、日志、AI 上下文四个标签页；概况里展示恢复卡片、端口区和 Git 概况。
- 设置页：项目根目录管理、编辑器命令、检查更新、语言、主题模式和强调色。

## Windows 桌面安装与更新

Release 页面会同时提供两个 Windows 产物：

```txt
Dev-Cockpit-Setup-<version>-win-x64.exe   标准安装向导
Dev-Cockpit-<version>-win-x64.exe         免安装版
```

推荐普通用户下载 `Setup` 安装包。它会出现常规安装向导，可以选择安装路径、创建桌面快捷方式，并对已安装版本执行覆盖升级。免安装版适合临时试用；如果之前运行过旧的免安装 exe，直接关闭旧进程后替换新文件即可。

应用启动后会自动轻量检查更新：优先读取 GitHub Release；如果 GitHub API 因网络、代理、证书或限流失败，会改用 npm registry 获取最新版本号，并继续给出 GitHub Release 下载入口。发现新版本时，左上角品牌区会出现闪烁的下载图标；也可以在设置页点击“检查更新”，手动下载安装包或免安装版。当前版本仍未签名，Windows 可能提示未知发布者；正式公开分发前需要补代码签名。

## 开发与贡献

```bash
pnpm install
pnpm build
pnpm --filter local-dev-cockpit dev
```

Windows 桌面版验证：

```bash
pnpm --filter @local-dev-cockpit/desktop build
pnpm --filter @local-dev-cockpit/desktop dist:win
```

产物会输出到：

```txt
apps/desktop/release/Dev-Cockpit-Setup-<version>-win-x64.exe
apps/desktop/release/Dev-Cockpit-<version>-win-x64.exe
```

Setup 安装包用于常规安装和覆盖升级，portable exe 用于免安装试用。两个产物当前都未签名。

质量检查：

```bash
pnpm release:check
```

贡献入口见 [CONTRIBUTING.md](CONTRIBUTING.md)，路线图见 [docs/roadmap.md](docs/roadmap.md)。

## 本地数据

Dev Cockpit 的数据只保存在本机：

```txt
%APPDATA%\local-dev-cockpit\config.json
%APPDATA%\local-dev-cockpit\state.json
%APPDATA%\local-dev-cockpit\logs\*.log
```

默认不会写入你的项目目录。只有点击 AI 上下文标签里的“写入文件”，或执行 `context --write`，才会在目标项目写入 `PROJECT_CONTEXT.md` 和 `AGENTS.md`。

## 架构

这是一个为未来 Electron/Tauri 桌面版预留的 monorepo：

```txt
packages/core    项目扫描、技术栈识别、命令推断、Git/端口状态、AI 上下文
packages/server  本地 HTTP API、WebSocket、进程生命周期和日志管理
packages/cli     npx 入口、scan/doctor/context 命令、打包 Web 资源
apps/web         Vue 3 + Vite + Pinia + Vue Router Dashboard
apps/desktop     Electron 桌面壳，复用同一套 server 和 Vue 面板
```

核心约束：

- `core` 不依赖 Vue、HTTP server 或 CLI。
- 命令执行使用 `command + args`，避免拼接 shell 字符串。
- API 输入用 `zod` 校验。
- 日志使用内存 ring buffer + 文件落盘，避免大日志撑爆内存。
- CLI 发布包会把 Vue 面板一起打进 `packages/cli/dist/web`，保证 `npx local-dev-cockpit` 可以独立运行。

更详细设计见 [docs/architecture.md](docs/architecture.md)。

## 当前阶段

当前是 `0.1.10` 可运行原型，重点验证方向：本地项目恢复、日志聚合、运行地址识别、AI 上下文生成、运行环境诊断、终端 Conda/venv 继承、按需 Conda 环境候选、monorepo 子项目发现、更新检查兜底、简洁面板体验、Windows 安装更新流程和 Dev Pilot 首屏品牌体验。下一步会继续减少操作步骤，补充更多真实项目扫描样本、进程异常恢复和配置编辑能力。
