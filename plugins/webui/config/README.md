# @koishi-ce/plugin-config

**简体中文** | [English](#english)

控制台的插件配置管理器，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/config`。它把 koishi.yml / koishi.json 的完整配置树推送到浏览器，并在网页上完成插件与机器人配置的查看、修改、启停、增删——所有改动经 loader 写回配置文件。需要先启用 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console)。

## 功能与页面

- **插件配置页**（`/plugins/:name*`，权限 4）：本机与工作区全部插件包的列表、运行时状态（schema / usage / inject / fork）与配置编辑；含一个「应用全局设置」条目；
- **配置树右键菜单**：停用 / 启用、保存 / 重载、重命名、移除、克隆、管理同一插件的多份配置（fork）、添加插件与分组；
- **服务数据**：`packages`（插件包列表）、`services`（服务名到提供者的映射）、`config`（整份配置流，均要求权限 4）；
- **浏览器端编程接口**：其他控制台插件可经 `configWriter` 服务对配置做 ensure / remove / get 操作。

配置来源不可写（非文件型配置）时仅告警跳过。

## 配置项

本插件自身无需配置。

## 用法

```bash
bun add @koishi-ce/plugin-config
```

```yaml
plugins:
  console: {}
  config: {}
```

## CE 相对上游的调整

- 工作区包收集额外遍历 loader 配置树，把「相对路径键」（`./plugins/...`）引用的 workspace 源码包也纳入插件列表——Bun 不会把未被依赖的 workspace 包链入 node_modules，不做这步它们会在配置页「消失」；
- 插件是否驻留内存的判定改用纯 fs 的 `isResidentInCache`，规避 Bun 解析快照缓存导致的安装瞬间 "failed to resolve" 假警。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。本包是上游 koishijs/webui 的社区再分发，版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The plugin configuration manager for the console, ported from `plugins/config` of the upstream [koishijs/webui](https://github.com/koishijs/webui). It streams the full koishi.yml / koishi.json config tree to the browser and lets you view, edit, enable, disable, add and remove plugin and bot configurations on the web — every change is written back through the loader. Requires [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console).

## Features and pages

- **Plugin config page** (`/plugins/:name*`, authority 4) — lists all local and workspace plugin packages with runtime state (schema / usage / inject / fork) and config editing, including an "app global settings" entry.
- **Config tree context menu** — disable / enable, save / reload, rename, remove, clone, manage multiple forks of a plugin, add plugins and groups.
- **Service data** — `packages`, `services` (service name to provider mapping) and `config` (the whole config stream), all requiring authority 4.
- **Browser-side API** — other console plugins may use the `configWriter` service (ensure / remove / get).

Skips with a warning when the config source is not writable.

## Configuration

None.

## Usage

```bash
bun add @koishi-ce/plugin-config
```

```yaml
plugins:
  console: {}
  config: {}
```

## CE adjustments

- Workspace package collection additionally walks the loader config tree so plugins referenced by relative-path keys (`./plugins/...`) appear in the list — Bun does not link undepended workspace packages into node_modules, and without this step they would vanish from the page.
- In-memory residency checks use the pure-fs `isResidentInCache`, avoiding the transient "failed to resolve" false alarm caused by Bun's resolution snapshot cache.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Community redistribution of upstream koishijs/webui; copyright Shigma and Koishijs contributors (upstream) and Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
