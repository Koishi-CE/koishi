# @koishi-ce/registry

**简体中文** | [English](#english)

Koishi 插件市场的扫描与清单库，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `packages/registry`。它负责从 npm registry 搜索并分析 Koishi 插件包、判定与目标框架版本的兼容性、以及扫描本地已安装的插件——是插件市场与依赖管理的数据底座。

## 主要导出

- `Scanner`（默认导出）：远程扫描器，两阶段工作——`collect()` 分页调用 npm registry 搜索接口（页间留 margin 重叠抗数据变动），`analyze()` 并发拉取逐包详情，按 `peerDependencies.koishi` 与目标版本范围的 semver intersects 筛选兼容版本，并填充 manifest、短名、分类、发布时间等展示字段。静态方法 `isPlugin` 识别 `@koishi-ce/plugin-*`、`@koishijs/plugin-*` 与 `koishi-plugin-*` 三种命名，`isCompatible` 判定兼容性。
- `LocalScanner`：扫描 baseDir 及其全部祖先目录 node_modules 中的已装插件，不发任何网络请求。
- 工具函数：`getPluginShortname`（剥离三种插件名前缀）、`resolvePackageJson`、`isResidentInCache`（判定包是否已驻留内存）、`conclude`（把 package.json 的 koishi 字段与关键词归纳为结构化 Manifest）。
- 类型：`PackageJson` / `Manifest` / `SearchObject` / `SearchResult` / `RemotePackage` 等。

HTTP 请求不由本包发出：构造 `Scanner` 时注入 request 函数，便于宿主复用自身的 HTTP 服务与代理配置。

## 面向谁

普通用户无需安装。本包被 [`@koishi-ce/plugin-market`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/market)（市场与依赖管理插件）消费；`resolvePackageJson` 与 `isResidentInCache` 采用纯文件系统实现，规避 Bun 解析器对失败解析的进程内快照缓存，这是「市场装完插件无需重启即可加载」防御链的一部分。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/webui 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The market scanning and manifest library for Koishi plugins, ported from `packages/registry` of the upstream [koishijs/webui](https://github.com/koishijs/webui). It searches and analyzes Koishi plugin packages from the npm registry, determines compatibility with a target framework version, and scans locally installed plugins — the data foundation of the plugin market and dependency management.

## Key exports

- `Scanner` (default export) — two-phase remote scanning: `collect()` pages through the npm registry search API (with overlapping margins between pages), then `analyze()` fetches per-package details, filters versions by semver intersection with `peerDependencies.koishi`, and fills in manifest, shortname, category and time fields. Static helpers `isPlugin` (recognizing `@koishi-ce/plugin-*`, `@koishijs/plugin-*` and `koishi-plugin-*`) and `isCompatible`.
- `LocalScanner` — scans node_modules of the base directory and all ancestor directories, with zero network requests.
- Utilities — `getPluginShortname`, `resolvePackageJson`, `isResidentInCache`, `conclude`, plus the `PackageJson` / `Manifest` / `SearchResult` types.

No HTTP is performed by this package itself: a request function is injected into the `Scanner` constructor so hosts can reuse their own HTTP service and proxy settings. `resolvePackageJson` and `isResidentInCache` are deliberately pure-fs to dodge Bun's in-process snapshot caching of failed resolutions — part of the "no restart needed after installing a plugin" defense chain used by `@koishi-ce/plugin-market`.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/webui; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
