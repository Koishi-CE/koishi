---
"@koishi-ce/plugin-hmr": minor
---

文件监听从 chokidar 换为 @parcel/watcher 原生绑定：ignored 规则（`**/node_modules/**` 等 glob）在原生层剪枝生效，被忽略目录内的写入不再产生任何事件，同时删除了为 chokidar 5 win32 glob 失效而设的段剪枝补丁（compileGlobToPrune）。监听行为保持对齐：仅文件内容变更（update 事件）触发重载流程，事件路径为绝对路径；root 支持目录与文件条目（文件经「订阅所在目录 + 路径过滤」实现）。配置透传面由 chokidar 选项变为 @parcel/watcher 选项（如 `backend`）。原生绑定经 Bun 运行时 win32 实证可用，并新增冒烟测试钉死该前提；explorer 插件不受影响（仍用 chokidar）。
