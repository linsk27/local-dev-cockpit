# local-dev-cockpit

Dev Cockpit 的 CLI 入口。

```bash
npx local-dev-cockpit
```

默认启动本地面板：

```txt
http://localhost:8787
```

常用命令：

```bash
local-dev-cockpit scan <dir>
local-dev-cockpit add-root <dir>
local-dev-cockpit doctor
local-dev-cockpit context <projectPath>
local-dev-cockpit context <projectPath> --write
```

发布包会内置 Vue 面板产物，因此最终用户不需要单独安装前端依赖。
