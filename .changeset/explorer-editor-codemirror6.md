---
"@koishi-ce/plugin-explorer": minor
"@koishi-ce/plugin-theme-vanilla": patch
---

编辑器由 monaco 整体换为 CodeMirror 6：前端产物 **13.55 MB → 1.10 MB**（首屏静态可达约 441 KB），文件数 97 → 29。

- **体积来源说明**：monaco 的 `.` 入口会连带引入全部语言定义与 css / html / json / typescript 四个语言服务注册模块（其 worker 合计 9.15 MB），而本插件自移植起就在运行期用 `setModeConfiguration` 把这些语言服务全部关掉——这 9.15 MB 属"付了钱不用"，且仅改单处导入无法摘除。
- **语言**：改为 27 种语法的按需加载（YAML / JSON / JS / TS / JSX / TSX / HTML / XML / CSS / SCSS / Sass / Less / Markdown / Python / SQL / Java / C/C++ / Rust / Go / PHP / Vue，以及经 `@codemirror/legacy-modes` 包装的 Shell / PowerShell / TOML / Dockerfile / INI / Diff）。每个语言独立成 chunk，只在打开对应类型文件时下载；清单集中在 `client/languages.ts`，新增语言只需装包 + 加一项。
- **主题**：编辑器配色收敛为一组 `--cm-*` 变量（`client/editor.scss`），跟随控制台主题变量；`theme-vanilla` 的 coffee-dark 同步把原 monaco 变量覆写改写为 `--cm-*` 覆写。
- **行为差异**：不再向 `window` 挂全局 `monaco` 命名空间（仓库内无消费者）；不再有 worker，控制台侧为 monaco worker 做的根绝对路径兜底自此不再被触发（兜底逻辑保留）。
- 编辑器容器改为 CodeMirror 实例持有文档（不再有全局共享 model），容器尺寸自适应故移除手动 layout 调用。
