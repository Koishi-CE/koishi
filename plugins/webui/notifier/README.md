# @koishi-ce/plugin-notifier

**简体中文** | [English](#english)

控制台通知中心插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/notifier`。它提供两种通知形态——显示在插件详情页的常驻通知条，以及向所有已连接控制台广播的即时消息——并以 `notifier` 服务（`ctx.notifier`）供其他插件调用。

## 功能与页面

本插件没有独立页面：插件详情页插槽展示该插件的常驻通知；即时消息广播到浏览器后弹出消息条，路由切换时自动关闭。

服务 API：

- `ctx.notifier.create(options)`：创建一条常驻通知，返回 Notifier 实例，可用 `update(options)` 更新、`dispose()` 移除。`type` 为 `primary` / `success` / `warning` / `danger`（对应提示条配色）；`content` 支持字符串或元素片段（可含按钮），按钮回调登记在服务端、浏览器点击时经 `notifier/button` 事件回传执行。
- `ctx.notifier.message(options)`：向所有已连接的控制台广播一条即时消息通知。

## 配置项

本插件无需配置。

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-notifier
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  notifier: {}
```

## 备注

- 按钮回调无法跨进程序列化，因此以随机 key 传给浏览器、点击时回调；通知更新时旧回调自动清理。
- 无指令、无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/notifier`。

---

## English

Console notification center plugin, ported from `plugins/notifier` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It provides persistent notification bars on plugin detail pages and instant messages broadcast to every connected console, exposed as the `notifier` service (`ctx.notifier`).

## Features

No standalone page: a plugin-details slot shows persistent notifications; instant messages pop up as message bars, closed automatically on route change. Service API:

- `ctx.notifier.create(options)`: creates a persistent notification; update with `update(options)`, remove with `dispose()`. `type` is `primary` / `success` / `warning` / `danger`; `content` accepts strings or element fragments (buttons allowed — click callbacks are registered server-side and invoked via the `notifier/button` event).
- `ctx.notifier.message(options)`: broadcasts an instant message to all connected consoles.

## Configuration

None.

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-notifier
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  notifier: {}
```

## Notes

- No commands, no tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/notifier`.
