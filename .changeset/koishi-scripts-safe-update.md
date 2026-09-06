---
"@koishi-ce/scripts": minor
"create-koishi-ce": patch
---

新增 `koishi-scripts update` 安全更新命令，模板接线为 `bun run update`：

- 裸 `bun update` 是全树更新语义，会连带给市场安装的第三方插件与全部传递依赖重新求解，任一上游漂移都可能破坏运行时；下游项目实际需要跟随的只有 @koishi-ce/* 生态位。
- update 命令以 @koishi-ce/* 为白名单显式执行 `bun update <pkg...>`，四行 npm alias 冻结线、市场安装的 koishi-plugin-* 与 bun-types 一律不碰。
- 内置模板 scripts 挂载 `"update": "koishi-scripts update"`，模板 README 新增「更新依赖」小节并警示勿用裸 `bun update`。
