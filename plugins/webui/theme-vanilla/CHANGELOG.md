# @koishi-ce/plugin-theme-vanilla

## 1.0.4

### Patch Changes

- db59fd0: 编辑器由 monaco 整体换为 CodeMirror 6：前端产物 **13.55 MB → 0.72 MB**（首屏静态可达约 431 KB），文件数 97 → 23。
  
  - **体积来源说明**：monaco 的 `.` 入口会连带引入全部语言定义与 css / html / json / typescript 四个语言服务注册模块（其 worker 合计 9.15 MB），而本插件自移植起就在运行期用 `setModeConfiguration` 把这些语言服务全部关掉——这 9.15 MB 属"付了钱不用"，且仅改单处导入无法摘除。
  - **语言**：改为 21 种语法的按需加载（YAML / JSON / JS / TS / JSX / TSX / HTML / XML / CSS / SCSS / Sass / Less / Markdown / SQL / Vue，以及经 `@codemirror/legacy-modes` 包装的 Shell / PowerShell / TOML / Dockerfile / INI / Diff）。每个语言独立成 chunk，只在打开对应类型文件时下载；清单集中在 `client/languages.ts`，新增语言只需装包 + 加一项。
  - **语言选取原则**：只收录 Koishi 生态真实会出现的类型（纯 TS / JS 世界）；后端语言（Python / Java / C-C++ / Rust / Go / PHP）已整体剔除（连同 6 个依赖包），这类文件回退纯文本。
  - **主题**：编辑器配色收敛为一组 `--cm-*` 变量（`client/editor.scss`），跟随控制台主题变量；`theme-vanilla` 的 coffee-dark 同步把原 monaco 变量覆写改写为 `--cm-*` 覆写。
  - **行为差异**：不再向 `window` 挂全局 `monaco` 命名空间（仓库内无消费者）；不再有 worker，控制台侧为 monaco worker 做的根绝对路径兜底自此不再被触发（兜底逻辑保留）。
  - 编辑器容器改为 CodeMirror 实例持有文档（不再有全局共享 model），容器尺寸自适应故移除手动 layout 调用。
- Updated dependencies [bcaad36]
  - @koishi-ce/plugin-console@1.3.6

## 1.0.3

### Patch Changes

- e537fa2: fallow 审计收敛：断掉 core 最后一处循环依赖并收敛重复代码样板（1024 → 357 行）。
  
  - core：runtime.ts 的 `Service.setup` 经新增的 context 工厂槽（`context/factory.ts`）创建 root Context，消除 context/index.ts ↔ runtime.ts 模块环，公共 API 不变。
  - console（核心包）：新增 `clientEntry` 导出——插件向控制台注册前端产物的三环境路径样板（KOISHI_BASE 部署 / browser 构建 / 本地 dev-prod），各 webui 插件入口的三分支复制统一改为一行调用。
  - client：新增 `extendLocales`（插件前端入口的七语种词典批量注入，配合 `import.meta.glob` 收敛 import+extend 样板）与 `scrollActiveTree`（keep-alive 页面重激活时把 el-tree 激活节点滚到可视中央）。
  - loader：公共导出 `insertKey` / `rename`（键顺序保持式改名工具），config 插件 writer 复用之。
  - utils：新增 npm-registry 模块（`getLocalRegistry` / `readNpmrcRegistry` / `NPM_OFFICIAL_REGISTRY`），create-koishi-ce 与 market 的本机 registry 探测共享同一实现。
  - config：manager/* 事件签名收敛到 `src/shared/console-events.ts` 唯一定义（node 与浏览器两端声明合并经 extends 引用）；global/group 设置面板的 modelValue 代理改用 `defineModel`。
  - admin/sandbox/sqlite/check-docs-links：对称逻辑（用户组加入与移出、方向键历史回溯、`_all`/`_get` 读取原语、链接检查循环）就近抽取共享实现。
- Updated dependencies [e537fa2]
  - @koishi-ce/console@1.1.0
  - @koishi-ce/plugin-console@1.3.4
  - @koishi-ce/koishi@1.0.16

## 1.0.2

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
- Updated dependencies [8b081a7]
  - @koishi-ce/koishi@1.0.4
  - @koishi-ce/plugin-console@1.0.3

## 1.0.1

### Patch Changes

- d1329eb: feat(eco): 再分发五个上游官方插件，补齐官方实例默认插件版图
  
  - **@koishi-ce/plugin-theme-vanilla**（上游 koishijs/theme-vanilla，AGPL）：八套控制台主题（coffee / ocean / pale-night / solarized / winter 各系）
  - **@koishi-ce/plugin-server-temp**（上游 cordiverse/server @cordisjs/plugin-server-temp，MIT，src 化移植）：`server.temp` 服务——临时文件落盘、`/temp/:name` 路由与到期清理
  - **@koishi-ce/assets**（上游 @koishijs/assets 基类包，MIT）+ **@koishi-ce/plugin-assets-local**（上游 koishi-plugin-assets-local，MIT）：assets 资源服务抽象与本地目录实现（魔数判型、HMAC 上传校验、旧 public/ 目录迁移）；文件类型探测改用 file-type@22 的 fileTypeFromBuffer（与 explorer 同线，不引入 16.x 双版本），GET 路由以头部字节判定 MIME
  - **@koishi-ce/plugin-rate-limit**（上游 koishijs/common packages/rate-limit，MIT）：指令调用次数 / 频率限制，usage / timer 管理命令，上游测试全量移植为 bun:test
  - **@koishi-ce/plugin-dataview**（上游 koishijs/koishi-plugin-dataview，AGPL）：控制台数据库查看与管理（minato 深层 API、client 类型镜像走 market 范式）
  - analytics 的未使用依赖 `@koishijs/assets` 换为 `@koishi-ce/assets`
  - 上游 telemetry 评估后放弃移植：未发布半成品、无 LICENSE 正文、硬编码第三方遥测后端且采集机器指纹
