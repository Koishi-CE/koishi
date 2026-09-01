# @koishi-ce/plugin-insight

**简体中文** | [English](#english)

插件依赖图插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/insight`。它把 cordis 运行时的拓扑结构——插件的 fork 关系与服务注入关系——推送给前端，以力导向图直观呈现整个应用的依赖网络。

## 功能与页面

- 「依赖图」页面：路由 `/graph`（order 550），用力导向图渲染当前运行时：
  - 实线边表示插件调用 / fork 关系；
  - 虚线边表示服务注入（必需依赖）关系。
- 节点属性：
  - `weight`：取该 scope 的 disposables 数量，影响节点视觉权重；
  - `isGroup` / `isRoot`：分组节点与根应用（App）标记；
  - `services`：该节点上下文中注册的服务名列表。
- 完全可复用、部分可复用与不可复用三类插件按不同的连线形态区分展示。

## 配置项

本插件无需配置。

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-insight
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  insight: {}
```

## 备注

- 提供 `insight` 数据服务（nodes + edges）；监听 `internal/fork`、`internal/runtime`、`internal/service`、`internal/status` 内部事件，防抖后整体刷新图数据。
- 无指令、无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/insight`。

---

## English

Plugin dependency graph plugin, ported from `plugins/insight` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It pushes the cordis runtime topology — plugin fork relations and service injections — to the frontend, rendered as a force-directed graph.

## Features and Pages

- "Dependency Graph" page: route `/graph` (order 550), a force-directed graph of the current runtime:
  - Solid edges: plugin call / fork relations.
  - Dashed edges: service injection (required dependencies).
- Node attributes: `weight` (number of disposables, affecting visual weight), `isGroup` / `isRoot` flags, and `services` (service names registered in that scope).
- Fully reusable, partially reusable, and non-reusable plugins are drawn with distinct edge patterns.

## Configuration

None.

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-insight
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  insight: {}
```

## Notes

- Provides the `insight` data service (nodes + edges); refreshes (debounced) on `internal/fork`, `internal/runtime`, `internal/service`, and `internal/status` events. No commands, no tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/insight`.
