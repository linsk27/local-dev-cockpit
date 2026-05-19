# local-dev-cockpit

Dev Cockpit 的 CLI 入口。本地启动一个 Vue 3 面板，用来恢复项目现场：项目列表、启动命令、Git 状态、端口、日志和 AI 上下文。

```bash
npx local-dev-cockpit
```

默认启动本地面板：

```txt
http://localhost:8787
```

常用命令：

```bash
# 启动 Web 面板
local-dev-cockpit

# 扫描指定目录
local-dev-cockpit scan <dir>

# 添加工作区根目录
local-dev-cockpit add-root <dir>

# 检查本机 Git / Node / Python / Go / Cargo
local-dev-cockpit doctor

# 生成 AI 上下文
local-dev-cockpit context <projectPath>
local-dev-cockpit context <projectPath> --write
```

发布包会内置 Vue 面板产物，因此最终用户不需要单独安装前端依赖。
