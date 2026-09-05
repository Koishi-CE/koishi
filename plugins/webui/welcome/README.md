# @koishi-ce/plugin-welcome

**简体中文** | [English](#english)

控制台首页欢迎卡插件：全高卡片、内容沉底，背景为 Lottie 开屏描线动画（射线扫过 + 圆环与四芒星成形），描线颜色经 CSS 类映射到控制台主题变量，自动适配明暗主题；`prefers-reduced-motion` 偏好下不挂动画、卡片回落紧凑形态。欢迎卡的「文档 / 论坛」入口与文案（7 语种）承自上游 webui client 的内建欢迎页，由本插件迁出为独立插件；动画数据移植自 MIT 授权的 [koishi-plugin-telemetry](https://www.npmjs.com/package/koishi-plugin-telemetry)（见仓库 `NOTICE`）。

## 功能与页面

挂载到控制台首页（`/`）的 `home` 插槽，`order: 1000`（analytics 统计面板沉于其下）。其他插件可通过 `welcome-choice` 插槽向欢迎卡追加自定义入口。

## 配置项

本插件无需配置。

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-welcome
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  welcome: {}
```

## 备注

- 不启用本插件时，首页仅保留插槽（analytics 等其他插件的首页面板不受影响）；脚手架（create-koishi-ce）默认模板已预写启用。
- 无指令、无数据表；动画为 lottie-web SVG-only 精简构建，随插件前端产物打包。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游内建欢迎卡部分）、ilharp（MIT 的 splash 动画数据）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

Welcome card plugin for the console home page: a full-height card with bottom-anchored content over a Lottie line-drawing splash animation (sweeping rays, then a ring and four-pointed star taking shape). Stroke colors are mapped to console theme variables via CSS classes and adapt to light/dark themes; with `prefers-reduced-motion` the animation is skipped and the card falls back to a compact form. The card's docs/forum entries and texts (7 locales) originate from the built-in welcome page of the upstream webui client, moved into this standalone plugin; the animation data is ported from the MIT-licensed [koishi-plugin-telemetry](https://www.npmjs.com/package/koishi-plugin-telemetry) (see the repository `NOTICE`).

## Features

Mounted into the `home` slot of the console home page (`/`) with `order: 1000` (the analytics panel sits below). Other plugins may append custom entries to the card via the `welcome-choice` slot.

## Configuration

None.

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-welcome
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  welcome: {}
```

## Notes

- When this plugin is disabled, the home page keeps only the slot (home panels of other plugins such as analytics are unaffected); the default template of create-koishi-ce ships with it pre-enabled.
- No commands, no tables; the animation uses the SVG-only build of lottie-web, bundled into the plugin's frontend dist.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream built-in welcome card), ilharp (MIT splash animation data), and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
