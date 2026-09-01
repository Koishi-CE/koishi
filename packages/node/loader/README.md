# @koishi-ce/loader

**简体中文** | [English](#english)

Koishi 的配置文件驱动插件加载器，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `packages/loader`。它负责读取 koishi.yml / koishi.json 配置文件、把配置表翻译成插件加载指令、并在运行期把插件与配置的增删改同步回配置文件。默认导出的 `NodeLoader` 是面向 Bun / Node 运行时的实现。

## 主要导出

- `NodeLoader`（默认导出）：Bun / Node 实现，宿主 CLI 的工作进程直接使用它启动应用；
- `Loader`：平台无关的抽象基类，浏览器等环境可自行派生；
- `extensions`：支持的配置文件扩展名集合；
- `pluginCandidates` / `resolvePlugin`：插件名到模块路径的解析；
- `unwrapExports`：模块导出解包。

另有 `./shared` 子路径导出环境无关的部分，供浏览器消费者复用。

## 核心机制

- **配置加载**：支持 `.json` / `.yaml` / `.yml` 三种格式；`${{ env.X }}` 表达式在加载时完成环境变量插值；`.env` 与 `.env.local` 文件自动注入。
- **插件配置表**：`group` 分组单元可嵌套；`name:ident` 形式的引用键支持同一插件的多份配置（fork）；`~` 前缀停用插件；`$` 前缀的 `$if` / `$filter` 元属性做条件加载。
- **配置回写**：运行期的插件变化经事件订阅写回配置文件——原子写入、合并并发写、挂起机制防止监听回环。
- **插件名解析**：裸名候选前缀优先级为 `@koishi-ce/plugin-` > `@koishijs/plugin-` > `koishi-plugin-`，兼容社区生态；`paths()` 计算每个插件的路径供控制台定位。
- **旧配置迁移**：自动把旧版 request 内联配置迁移为 http 插件、代理配置迁移为 proxy-agent 插件、port / host 迁移为 server 插件。
- **重启协议**：`fullReload` 以退出码 51 请求父守护进程整体重启，`KOISHI_SHARED` 在跨重启间共享数据——这是热重载（HMR）插件的底层支持。

## CE 相对上游的增强

- **CJS 互操作种子**（`node/interop.ts`）：Bun 会把 exports 的 `bun` 条件用在 require 上，导致部分包（典型如 postgres@3.4.x）在 CJS 依赖链里被 require 到 ESM 入口而报错。加载插件前会遍历依赖树，对 Node require 语义入口与 Bun 解析入口有分歧的包预置 `require.cache` 种子。
- **纯 fs 解析兜底**（`node/resolve.ts`）：Bun 对失败的解析按父目录快照做进程内缓存，市场装完插件后裸名解析可能永久失败。`resolvePlugin` 在解析 API 失败后改用纯文件系统沿 node_modules 链定位包目录并计算入口绝对路径，装完无需重启即可加载。

## 用法

通常由 `@koishi-ce/koishi` 的 `koishi start` 在内部调用。编程式用法：

```ts
import NodeLoader from "@koishi-ce/loader";

const loader = new NodeLoader();
await loader.init();            // 可传入配置文件名，缺省自动探测
const app = await loader.createApp();
await app.start();
```

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The config-driven plugin loader of Koishi, ported from `packages/loader` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi). It reads koishi.yml / koishi.json, translates the config tree into plugin loading instructions, and syncs runtime plugin changes back to the config file. The default export `NodeLoader` targets Bun / Node.

## Key mechanisms

- **Config loading** — `.json` / `.yaml` / `.yml` formats, `${{ env.X }}` interpolation, automatic `.env` / `.env.local` injection.
- **Plugin config tree** — nestable `group` units, `name:ident` reference keys for multiple plugin forks, `~` prefix to disable, `$if` / `$filter` meta properties.
- **Write-back** — atomic, coalesced writes of runtime plugin changes, with a suspend mechanism to avoid listener loops.
- **Plugin resolution** — bare-name candidate prefixes `@koishi-ce/plugin-` > `@koishijs/plugin-` > `koishi-plugin-`, compatible with the community ecosystem.
- **Migration** — legacy inline `request` / proxy / `port` / `host` settings are migrated to the http / proxy-agent / server plugins.
- **Restart protocol** — `fullReload` exits with code 51 to ask the parent daemon for a full restart; `KOISHI_SHARED` carries data across restarts (the foundation of HMR).

## CE-specific enhancements

- **CJS interop seeding** — neutralizes Bun using the `bun` exports condition for `require`, which otherwise breaks packages like postgres@3.4.x inside CJS dependency chains.
- **Pure-fs resolution fallback** — works around Bun's parent-directory snapshot caching of failed resolutions, so freshly installed plugins load without a restart.

## Usage

Normally invoked by `koishi start` of `@koishi-ce/koishi`. Programmatically:

```ts
import NodeLoader from "@koishi-ce/loader";

const loader = new NodeLoader();
await loader.init();            // an optional config filename, auto-detected by default
const app = await loader.createApp();
await app.start();
```

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
