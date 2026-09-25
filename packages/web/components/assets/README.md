# assets

集中式图标资产目录（全仓唯一来源），供 unplugin-icons 在编译期转为 Vue 组件。

- **消费方式**：`import X from "~icons/k/<文件名去扩展名>"`（虚拟模块，构建接线在 `packages/web/builder/src/icons.ts`，workspace 与下游 npm 两形态均可用）；按字符串名渲染则经各包的注册表（`<k-icon name>` / `<market-icon name>`）。
- **命名规则**：一律平铺，目录分组以连字符编码进文件名；`market-` 前缀系 market vendor 三组（`market-` / `market-outline-` / `market-solid-`），其余为注册名直名或语义前缀（`activity-` / `analytic-`）。
- **尺寸契约**：svg 不写固定宽高（unplugin-icons 的默认 1em 注入已在 builder 剥除），尺寸由 `.k-icon { height: 1em }` 或消费方 CSS 控制，宽度按 viewBox 比例展开。
- **维护约定**：新图标=放入 .svg（保留 SPDX 头与语义注释）+ 在消费方注册或导入；本目录已整体豁免 biome 格式与 lint（`noSvgWithoutTitle` 不适用于装饰性资产，语义由使用方提供）；`~icons` 的 fallow 豁免在 `.fallowrc.jsonc`；上游同步时的 .vue → .svg 手动映射规则见 `docs/process/upstream.md`。
