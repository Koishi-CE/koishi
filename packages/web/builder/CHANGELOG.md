# @koishi-ce/console-builder

## 1.0.6

### Patch Changes

- Updated dependencies [e9258a1]
  - @koishi-ce/client@1.4.3
  - @koishi-ce/components@1.1.1
  - @koishi-ce/console-app@1.0.4

## 1.0.5

### Patch Changes

- 86fec5e: 修复来自 `assets/icons` 的图标偏小（侧栏的欢迎、插件市场、依赖管理等）：图标产物不再带 1.2em 固定宽高，尺寸交还 CSS。
  
  - **根因**：unplugin-icons（@iconify/utils 3.x）先调用 `iconCustomizer`、随后才由 `configureSvgSize` 按 `scale`（默认 1.2）补写 `width`/`height`，因此原先的 `delete props["width"]` 删的是尚未写入的键，属于空操作；产物仍带 `width="1.2em" height="1.2em"`。侧栏 `.activity-button-icon` 只设 `height`（1.5rem），svg 视口被 1.2em 锁死宽度并按宽度贴边，方形与扁形图标撑不满高度——欢迎（1152×1024）、插件市场（512×512）、依赖管理（640×512）因此比同一栏里无 width 属性的图标小一半左右。
  - **修法**：`iconCustomizer` 改为写入 iconify 的取消关键字 `unset`（`isUnsetKeyword` 识别 `unset`/`undefined`/`none`），`configureSvgSize` 据此丢弃这两项；产物只保留 class 与 viewBox，高度由 CSS 决定、宽度按 viewBox 比例展开。
  - **回归测试**：新增构建级用例，真实跑一遍 unplugin-icons 编译链并断言产物不含 `width`/`height`；同时用 `delete` 版本反向锁定「删不掉」的成因，unplugin-icons 若调整调用顺序该用例会失败，提示实现可简化。
  - **注释更正**：9/26 引入的注释剥除所依据的「多根 fragment」机理不成立（@iconify/utils 的 `getCustomIcon` 本就切掉 `<svg` 之前的内容），单根只是 class 透传的前提，相关注释已按实际关系改写。
  - **连带重发**：宿主 console 与 13 个 webui 插件的前端 dist 都编译进了这批图标资产，逐包 patch 重发后新尺寸才会到下游。
- @koishi-ce/client@1.4.2

## 1.0.4

### Patch Changes

- 4dac9a8: 图标编译钉死单根产物，消除构建环境 NODE_ENV 漂移引发的透传断裂：
  
  - `FileSystemIconLoader` 增加 transform 回调，在 loader 层剥除 svg 根元素之前的注释（许可头、版权头等）。unplugin-icons 的 vue3 编译器调用 `compileTemplate` 时未透传 comments 选项，注释去留随构建进程的 NODE_ENV 漂移：development 环境下注释保留进产物，图标组件被编译成「注释 + svg」的多根 fragment；Vue 运行时对该 fragment 的 attribute 透传修复（getChildRoot）仅在 dev 运行时生效，prod 运行时外部 class 落不到 svg 上，侧栏图标回落 `.k-icon { height: 1em }` 的 1em 尺寸。剥除后产物恒为单根，与编译模式无关；
  - 新增 `stripLeadingSvgComments` 导出与四用例单测（许可头剥离、无注释原样、内部注释保留、连续注释段）。

## 1.0.3

### Patch Changes

- 4e3e49b: 构建管线的静默失败可观测化改造：
  
  - 工作区别名计算抽出独立模块（新增 `collectWorkspaceAliases` 导出，repoRoot 参数化可测试），消除两处静默吞错：仓库根清单损坏打印 error 后降级空表（下游安装形态无清单仍静默空表）、单个工作区包清单损坏打印 warn 后跳过；
  - `build()` 返回布尔值标示是否执行了构建，`koishi-console build <目录>` 对无 client/ 的目录显式报错 exit 1，不再 exit 0 静默假成；
  - 产物落盘循环对缺 source 的 asset 与缺 code 的 chunk 打印 warn，不再静默丢弃。
- Updated dependencies [74774de]
  - @koishi-ce/client@1.4.2
  - @koishi-ce/console-app@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [9a6ea29]
  - @koishi-ce/components@1.1.0
  - @koishi-ce/console-app@1.0.2
  - @koishi-ce/client@1.4.1

## 1.0.1

### Patch Changes

- Updated dependencies [f644c05]
- Updated dependencies [549520e]
  - @koishi-ce/client@1.4.0
  - @koishi-ce/console-app@1.0.1
