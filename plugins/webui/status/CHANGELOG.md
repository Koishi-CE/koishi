# @koishi-ce/plugin-status

## 1.1.4

### Patch Changes

- 86fec5e: 修复来自 `assets/icons` 的图标偏小（侧栏的欢迎、插件市场、依赖管理等）：图标产物不再带 1.2em 固定宽高，尺寸交还 CSS。
  
  - **根因**：unplugin-icons（@iconify/utils 3.x）先调用 `iconCustomizer`、随后才由 `configureSvgSize` 按 `scale`（默认 1.2）补写 `width`/`height`，因此原先的 `delete props["width"]` 删的是尚未写入的键，属于空操作；产物仍带 `width="1.2em" height="1.2em"`。侧栏 `.activity-button-icon` 只设 `height`（1.5rem），svg 视口被 1.2em 锁死宽度并按宽度贴边，方形与扁形图标撑不满高度——欢迎（1152×1024）、插件市场（512×512）、依赖管理（640×512）因此比同一栏里无 width 属性的图标小一半左右。
  - **修法**：`iconCustomizer` 改为写入 iconify 的取消关键字 `unset`（`isUnsetKeyword` 识别 `unset`/`undefined`/`none`），`configureSvgSize` 据此丢弃这两项；产物只保留 class 与 viewBox，高度由 CSS 决定、宽度按 viewBox 比例展开。
  - **回归测试**：新增构建级用例，真实跑一遍 unplugin-icons 编译链并断言产物不含 `width`/`height`；同时用 `delete` 版本反向锁定「删不掉」的成因，unplugin-icons 若调整调用顺序该用例会失败，提示实现可简化。
  - **注释更正**：9/26 引入的注释剥除所依据的「多根 fragment」机理不成立（@iconify/utils 的 `getCustomIcon` 本就切掉 `<svg` 之前的内容），单根只是 class 透传的前提，相关注释已按实际关系改写。
  - **连带重发**：宿主 console 与 13 个 webui 插件的前端 dist 都编译进了这批图标资产，逐包 patch 重发后新尺寸才会到下游。
- Updated dependencies [86fec5e]
  - @koishi-ce/plugin-console@1.4.3

## 1.1.3

### Patch Changes

- 03da425: client 侧 tsconfig 严格选项对齐 node 侧（补 noPropertyAccessFromIndexSignature / noUnusedLocals / noUnusedParameters / noImplicitReturns / noFallthroughCasesInSwitch / noImplicitOverride / allowUnreachableCode / allowUnusedLabels 八项），并修复由此暴露的存量类型错误（未用导入、缺失返回路径、switch 贯穿与索引签名属性访问）；另新增 check:vue-types 影子基线闸门（vue-tsc 全量快照只拦新增）。
- 51e871b: 类型债清偿中判空守卫显形的三处运行时缺陷修复：market 配置缺省 override 字段时批量安装模式暂存崩溃（缺省初始化为空对象）、market 手动安装响应缺 dist-tags 时空引用（判空保持对话框开启）、status 分析页首渲染无守卫解引用 store.status（缺失时按 0 降级，对齐同插件其他页面）。

## 1.1.2

### Patch Changes

- Updated dependencies [e537fa2]
  - @koishi-ce/console@1.1.0
  - @koishi-ce/plugin-console@1.3.4
  - @koishi-ce/koishi@1.0.16

## 1.1.1

### Patch Changes

- Updated dependencies [412c225]
  - @koishi-ce/console@1.0.1
  - @koishi-ce/plugin-console@1.3.3
  - @koishi-ce/koishi@1.0.15

## 1.1.0

### Minor Changes

- f66c005: i18n: 清剿存量假翻译并新增词典检查工具
  
  - broadcast / callme / echo / help / hmr / admin / logger / status 及 core 的 prompt-argument、commands.$ 等非中文语种中的上游中文占位全部替换为真翻译（含 ja-JP 残留）
  - 新增 `bun tooling/check-locales.ts`：以 zh-CN 为基准检查全仓词典的键对齐、语种齐全与假翻译（market 等上游再分发目录按约定跳过/豁免），当前零报警

### Patch Changes

- Updated dependencies [bac9f1d]
  - @koishi-ce/plugin-console@1.1.0
  - @koishi-ce/koishi@1.0.8

## 1.0.1

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
