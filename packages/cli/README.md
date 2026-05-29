# local-dev-cockpit

Dev Cockpit 的 npm CLI 入口。它会在本机启动一个 Vue 3 面板，用来恢复本地开发现场：项目列表、启动命令、Git 状态、端口、日志、诊断、AI 上下文和 Resource Radar 资源收集箱。

```bash
npx local-dev-cockpit
```

默认打开：

```txt
http://localhost:8787
```

桌面版下载：[GitHub Releases](https://github.com/linsk27/local-dev-cockpit/releases)

## 常用命令

```bash
# 启动 Web 面板
local-dev-cockpit

# 扫描指定目录
local-dev-cockpit scan <dir>

# 添加工作区根目录
local-dev-cockpit add-root <dir>

# 检查本机 Git / Node / Python / Go / Cargo 等环境
local-dev-cockpit doctor

# 检查某个项目的运行环境和推荐命令
local-dev-cockpit doctor <projectPath>

# 生成 AI 上下文
local-dev-cockpit context <projectPath>
local-dev-cockpit context <projectPath> --write
```

发布包内置 Web 面板产物，用户不需要单独安装前端依赖。

完整说明和截图见仓库 README：

https://github.com/linsk27/local-dev-cockpit#readme
