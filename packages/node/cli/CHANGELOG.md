# @koishi-ce/koishi

## 1.0.11

### Patch Changes

- Updated dependencies [0a72b50]
- Updated dependencies [f429185]
- Updated dependencies [361be0b]
- Updated dependencies [7eb0706]
- Updated dependencies [c822bfe]
- Updated dependencies [cabaa4d]
- Updated dependencies [3df874b]
  - @koishi-ce/core@1.1.2
  - @koishi-ce/loader@1.0.7
  - @koishi-ce/utils@1.0.0

## 1.0.10

### Patch Changes

- e2b121a: 修复 `koishi start` 在 Windows 下的选项静默失效：Bun.spawn 的默认 env 继承只取进程启动时的 OS 环境快照，运行时经 `process.env` 写入的 `KOISHI_LOG_LEVEL` / `KOISHI_DEBUG` / `KOISHI_LOG_TIME` / `KOISHI_CONFIG_FILE` / `KOISHI_SHARED` 传不到 worker 子进程（`--log-level`、`--debug` 等命令行选项无效、重启后共享环境数据丢失）。现显式展开 `env: { ...process.env }` 传递。
- @koishi-ce/core@1.1.1
  - @koishi-ce/loader@1.0.6
  - @koishi-ce/utils@1.0.0

## 1.0.9

### Patch Changes

- Updated dependencies [0b68ace]
  - @koishi-ce/core@1.1.1
  - @koishi-ce/loader@1.0.6
  - @koishi-ce/utils@1.0.0

## 1.0.8

### Patch Changes

- Updated dependencies [ad309a8]
- Updated dependencies [bac9f1d]
- Updated dependencies [f66c005]
  - @koishi-ce/plugin-http@1.0.1
  - @koishi-ce/plugin-proxy-agent@1.0.1
  - @koishi-ce/core@1.1.0
  - @koishi-ce/loader@1.0.6
  - @koishi-ce/utils@1.0.0

## 1.0.7

### Patch Changes

- f6c5088: 启动横幅标识由 `Koishi/版本` 改为 `Koishi-CE/版本`，并在交互终端下于启动时输出 KOISHI CE 字符画（非 TTY 环境自动跳过）。
- Updated dependencies [f6c5088]
  - @koishi-ce/loader@1.0.6
  - @koishi-ce/core@1.0.1
  - @koishi-ce/utils@1.0.0

## 1.0.6

### Patch Changes

- Updated dependencies [4c86c84]
  - @koishi-ce/core@1.0.1
  - @koishi-ce/loader@1.0.5
  - @koishi-ce/utils@1.0.0

## 1.0.5

### Patch Changes

- Updated dependencies [32d5593]
- Updated dependencies [7613c69]
  - @koishi-ce/loader@1.0.5
  - @koishi-ce/plugin-server@1.0.1
  - @koishi-ce/core@1.0.0
  - @koishi-ce/utils@1.0.0

## 1.0.4

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
- Updated dependencies [f63650b]
  - @koishi-ce/loader@1.0.4
  - @koishi-ce/core@1.0.0
  - @koishi-ce/utils@1.0.0

## 1.0.3

### Patch Changes

- 补齐默认导出（NodeLoader），修复入口注释宣称 `export default` 而实现缺失的不一致；`packages/shim/koishi-shim` 据此一名兼任 `koishi` 裸名 / `@koishijs/core` / `@koishijs/loader` 三个上游名的下游 alias 目标
- Updated dependencies [6f77b35]
  - @koishi-ce/loader@1.0.3
  - @koishi-ce/core@1.0.0
  - @koishi-ce/utils@1.0.0
  - @koishi-ce/plugin-http@1.0.0
  - @koishi-ce/plugin-proxy-agent@1.0.0
  - @koishi-ce/plugin-server@1.0.0

## 1.0.2

### Patch Changes

- Updated dependencies [bcfbe4e]
  - @koishi-ce/loader@1.0.2
  - @koishi-ce/core@1.0.0
  - @koishi-ce/utils@1.0.0
  - @koishi-ce/plugin-http@1.0.0
  - @koishi-ce/plugin-proxy-agent@1.0.0
  - @koishi-ce/plugin-server@1.0.0

## 1.0.1

### Patch Changes

- c9f7ef5: worker 启动流程新增端口预检：应用创建前探测 server 插件声明的端口区间（按包名识别，覆盖 vendored 包与上下游命名），全部被占时只输出一行提示并以退出码 1 干净退出——此前绑定失败会以 cordis 错误事件触发依赖 server 服务的全部插件连锁 dispose，刷出大片堆栈噪音。loader 顺势导出 `resolvePlugin` / `pluginCandidates` 供 worker 复用插件解析。
- Updated dependencies [c9f7ef5]
  - @koishi-ce/loader@1.0.1
  - @koishi-ce/core@1.0.0
  - @koishi-ce/utils@1.0.0
  - @koishi-ce/plugin-http@1.0.0
  - @koishi-ce/plugin-proxy-agent@1.0.0
  - @koishi-ce/plugin-server@1.0.0
