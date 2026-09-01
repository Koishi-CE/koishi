# @koishi-ce/plugin-actions

**简体中文** | [English](#english)

控制台动作机制插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/actions`。

本插件是一个 Node 侧占位包：`apply` 为空实现，自身不承载任何指令、配置或数据服务。它的作用是让控制台插件体系内的动作机制作为一个可识别的包出现在市场与配置层中；动作面板、菜单与全局快捷键的全部实现位于浏览器端的共享控制台前端（`@koishi-ce/client` 的 ActionService）：

- `ctx.action()`：注册动作，可绑定快捷键，由全局键盘事件统一分发（macOS 上 `ctrl` 自动映射为 `meta` 键）。
- `ctx.menu()`：注册菜单条目，动作面板与各页面菜单据此渲染。

其他控制台插件（指令管理、资源管理器、沙盒等）通过上述 API 把操作挂载到统一入口。

## 功能与页面

本插件没有独立页面，也不提供配置界面。启用后，控制台中的动作面板与菜单入口由共享前端和其他插件提供。

## 配置项

本插件无需配置。

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-actions
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  actions: {}
```

## 备注

- Node 侧源码（`src/index.ts`）仅保留插件骨架：声明 console 服务依赖与空配置 schema；面向开发者的动作 API（`ctx.action()` / `ctx.menu()` / 快捷键分发）由 `@koishi-ce/client` 在浏览器端实现。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/actions`。

---

## English

Console action plugin, ported from `plugins/actions` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository.

This package is a Node-side placeholder: `apply` is an empty implementation with no commands, config, or data services. It exists so that the action mechanism of the console plugin system is recognizable by the market and configuration layers; the action panel, menus, and global shortcuts are implemented entirely in the shared browser-side console frontend (`@koishi-ce/client`'s ActionService):

- `ctx.action()`: registers actions with optional shortcuts, dispatched by a global keydown listener (`ctrl` is mapped to `meta` on macOS).
- `ctx.menu()`: registers menu entries rendered in the action panel and page menus.

## Configuration

None.

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-actions
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  actions: {}
```

## Notes

- The Node-side source keeps only the plugin skeleton; the developer-facing action APIs live in `@koishi-ce/client` on the browser side.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/actions`.
