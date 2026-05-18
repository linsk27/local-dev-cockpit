# @local-dev-cockpit/core

Dev Cockpit 的纯 TypeScript 核心层，负责：

- 项目扫描和技术栈识别。
- 启动命令推断。
- Git 状态和端口状态采集。
- 恢复卡片生成。
- AI 上下文文本生成。

该包不依赖 Vue、server 或 CLI，方便单元测试和未来桌面端复用。
