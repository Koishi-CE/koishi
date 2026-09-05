# @koishi-ce/components

## 1.0.3

### Patch Changes

- cab60d9: client/tsconfig.json 就地声明 baseUrl 与 "schemastery-vue/client" 的 paths：compiler-sfc 解析 .vue 外部导入类型时以发起文件为起点向上找 tsconfig.json，下游没有仓库级配置、此前 extends 断链后 paths 丢失，dev 模式下编译 defineProps&lt;ActiveMenu&gt; 等跨包外部类型链时报 Failed to resolve import source。
- 08733b3: 修复虚拟列表首屏渲染区间为空的缺陷：本仓因严格 TS 把 `Virtual.range` 初始零值写死（上游为空对象、`start` 为 `undefined`），使构造函数 `checkRange(0, count)` 的 start 相等守卫（`0 !== 0` 恒假）跳过了首次 `updateRange`，`end` 停留在 0，首屏渲染区间为 `[0, 0)`。表现为日志页冷加载时历史日志全部不显示，直到第一条新日志（patch 使数组长度变化、触发无条件重算）才"唤醒"列表——日志安静的实例因此永久空白。现构造时绕过守卫直接写入初始区间 `[0, min(count, 总数))`，并补初始区间回归测试。

## 1.0.2

### Patch Changes

- 2665a25: 修复计算属性（computed）内层为 union 类型时 role 泄漏导致值控件不渲染、无法选择选项的问题（upstream: koishijs/koishi#1382）

## 1.0.1

### Patch Changes

- 8b081a7: knip 全仓清理：修真问题、配准误报。
  
  - 修复前端构建覆盖配置从未接线的问题：`koishi-console build` 现在会显式加载插件自带的 `build/client.ts` 并合并进 vite 配置（vite 不会自动发现该文件名），analytics 的 "fuck-echarts" Symbol 遮蔽修补自此真正生效，其 dist 已重建验证；explorer 的 monaco manualChunks 覆盖已删除（rolldown 自动分包已实现其目标且粒度更优）。
  - 修复 plugin-hmr 在无 `koishi` 裸名残留链接的环境下启动即崩的问题：框架依赖集的解析锚点由 `require.resolve("koishi")` 改为 `require.resolve("@koishi-ce/koishi")`（后者是其 peer 依赖，必然可解析）。
  - 依赖卫生：移除 11 处声明而未用的依赖（含 cli 的 `@satorijs/core`、actions/oobe/theme-vanilla 的 `@koishi-ce/console` 等）；为仅被类型引用或前端源码引用的包补齐 20 余处缺失声明（`vue` / `vue-router` / `@vueuse/core` / `element-plus` / `vite` 及各 `@koishi-ce/*` 类型借用）。
  - 死代码清理：sandbox node 侧无人消费的 `words` 昵称表、若干仅为模块内部使用却导出的符号与接口改为私有。
  - 新增根级 `knip.json`：登记前端构建入口与 cordis 插件双导出惯例等误报豁免，`bunx knip` 输出收敛至零（测试文件的 unlisted 依赖另行处理中）。
