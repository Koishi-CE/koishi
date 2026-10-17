---
"@koishi-ce/console-builder": patch
"@koishi-ce/plugin-console": patch
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-explorer": patch
"@koishi-ce/plugin-commands": patch
"@koishi-ce/plugin-locales": patch
"@koishi-ce/plugin-admin": patch
"@koishi-ce/plugin-auth": patch
"@koishi-ce/plugin-analytics": patch
"@koishi-ce/plugin-insight": patch
"@koishi-ce/plugin-status": patch
"@koishi-ce/plugin-dataview": patch
"@koishi-ce/plugin-config": patch
"@koishi-ce/plugin-sandbox": patch
"@koishi-ce/plugin-logger": patch
---

修复来自 `assets/icons` 的图标偏小（侧栏的欢迎、插件市场、依赖管理等）：图标产物不再带 1.2em 固定宽高，尺寸交还 CSS。

- **根因**：unplugin-icons（@iconify/utils 3.x）先调用 `iconCustomizer`、随后才由 `configureSvgSize` 按 `scale`（默认 1.2）补写 `width`/`height`，因此原先的 `delete props["width"]` 删的是尚未写入的键，属于空操作；产物仍带 `width="1.2em" height="1.2em"`。侧栏 `.activity-button-icon` 只设 `height`（1.5rem），svg 视口被 1.2em 锁死宽度并按宽度贴边，方形与扁形图标撑不满高度——欢迎（1152×1024）、插件市场（512×512）、依赖管理（640×512）因此比同一栏里无 width 属性的图标小一半左右。
- **修法**：`iconCustomizer` 改为写入 iconify 的取消关键字 `unset`（`isUnsetKeyword` 识别 `unset`/`undefined`/`none`），`configureSvgSize` 据此丢弃这两项；产物只保留 class 与 viewBox，高度由 CSS 决定、宽度按 viewBox 比例展开。
- **回归测试**：新增构建级用例，真实跑一遍 unplugin-icons 编译链并断言产物不含 `width`/`height`；同时用 `delete` 版本反向锁定「删不掉」的成因，unplugin-icons 若调整调用顺序该用例会失败，提示实现可简化。
- **注释更正**：9/26 引入的注释剥除所依据的「多根 fragment」机理不成立（@iconify/utils 的 `getCustomIcon` 本就切掉 `<svg` 之前的内容），单根只是 class 透传的前提，相关注释已按实际关系改写。
- **连带重发**：宿主 console 与 13 个 webui 插件的前端 dist 都编译进了这批图标资产，逐包 patch 重发后新尺寸才会到下游。
