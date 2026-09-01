# @koishi-ce/plugin-theme-vanilla

**简体中文** | [English](#english)

Vanilla 系列控制台主题包，移植自上游 [koishijs/theme-vanilla](https://github.com/koishijs/theme-vanilla)，共 8 套配色主题。安装后可在控制台「用户设置」的主题选择器中切换。

## 功能与页面

本插件没有独立页面，Node 侧仅向 console 注册浏览器侧入口，全部样式逻辑位于前端。提供的主题：

| 主题 ID | 显示名 |
| --- | --- |
| `coffee-dark` | Coffee Dark |
| `coffee-light` | Coffee Light |
| `pale-night-dark` | Pale Night |
| `ocean-dark` | Ocean Dark |
| `ocean-light` | Ocean Light |
| `solarized-dark` | Solarized Dark |
| `solarized-light` | Solarized Light |
| `winter-dark` | Winter Dark |

## 配置项

本插件无需配置。

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-theme-vanilla
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  theme-vanilla: {}
```

## 备注

- 主题选择结果保存在浏览器本地；无指令、无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/theme-vanilla](https://github.com/koishijs/theme-vanilla)。

---

## English

Vanilla theme pack for the Koishi console, ported from the upstream [koishijs/theme-vanilla](https://github.com/koishijs/theme-vanilla) repository, with 8 color themes. Switch themes from the picker in the console "User Settings" after installation.

## Features

No standalone page; the Node side only registers the browser entry with the console. Provided themes (id / name): `coffee-dark` (Coffee Dark), `coffee-light` (Coffee Light), `pale-night-dark` (Pale Night), `ocean-dark` (Ocean Dark), `ocean-light` (Ocean Light), `solarized-dark` (Solarized Dark), `solarized-light` (Solarized Light), `winter-dark` (Winter Dark).

## Configuration

None.

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-theme-vanilla
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  theme-vanilla: {}
```

## Notes

- Theme selection is stored in the browser. No commands, no tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/theme-vanilla](https://github.com/koishijs/theme-vanilla).
