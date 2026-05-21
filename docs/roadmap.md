# Roadmap

Dev Cockpit 当前处在 `0.1` 稳定核心阶段。目标不是继续堆模块，而是先把“本地项目恢复”做得可靠、轻量、容易理解。

## 0.1：稳定核心

已完成的核心能力：

- 通过 `npx local-dev-cockpit` 启动本地 Vue 3 面板。
- 提供 Windows Setup 安装包和 portable exe。
- 管理一个或多个项目根目录。
- 识别 Node、Python、Java、PHP、Ruby、.NET、Go、Rust、Docker 和混合项目。
- 识别 pnpm workspace、Turbo、Nx、Lerna、Rush 等 Node workspace，同时继续发现子项目。
- 启动 Python 命令前解析项目级绑定、`.vscode` 解释器、`.venv` / `venv`、Conda、终端继承环境、uv、Poetry 和 Pipenv。
- Java 项目优先使用 Maven / Gradle wrapper，并支持 Spring Boot 常见启动命令。
- 展示 Git 分支、未提交文件数、命令、端口、日志和 AI 上下文。
- 支持托管进程启动和停止。
- 识别 VS Code、Cursor、系统终端等外部启动的本地服务。
- 区分可访问服务和“端口被占用但 HTTP 不通”的残留端口。
- 支持中文/英文、主题、强调色和低消耗刷新。
- 设置页支持检查更新：优先 GitHub Release，失败时回退 npm registry。

## 0.2：真实项目可靠性

这个阶段仍然不新增大模块。重点是让不同用户电脑上的真实项目更容易跑起来、看得懂、修得动。

- 增强 macOS / Linux 的外部进程归属策略。
- 增加更多 Python 后端入口和虚拟环境诊断案例。
- 扩展 monorepo、PHP、Ruby、Java 和 .NET 的框架预设。
- 改进孤儿进程、残留端口和进程树清理。
- 增加真实 fixture 项目和浏览器回归检查。
- 改进缺少包管理器、缺少虚拟环境、依赖未安装时的修复建议。
- 继续把命令、日志、端口、Git、诊断和 AI 上下文收敛在项目详情页，不额外增加侧栏入口。

## 0.3：安装和升级体验

- 为 Windows 安装包补签名，减少安全提示。
- 评估应用内自动更新；在签名和回滚策略明确前，不做静默更新。
- 支持导入/导出本地工作区配置。
- 评估 Tauri，但前提是 Web + CLI + Electron 流程足够稳定。

## 后续模块候选

新模块只在稳定核心得到足够真实用户验证后再加。候选方向：

- 可选 AI 摘要：由用户自己配置 provider 和密钥。
- 可选插件系统：让用户补充自己的项目探测器。
- 本地依赖健康概览：仅对用户主动选择的项目启用。
- 多命令启动配方：例如前端 + 后端 + worker 一键恢复。
- SQLite 状态存储：只有 JSON 状态不够用时再迁移。

## 暂不做

- 替代 IDE 项目管理。
- 云同步、账号系统或团队权限。
- 默认上传源码到第三方服务。
- CI/CD、部署监控或生产运维。
- 自动创建虚拟环境或自动安装依赖。
