# core 层模块参考

> 状态：P2 已建成，门禁全绿。本文是 `src/shared/` 与 `src/core/` 的模块级参考：职责、文件、入口类的构造 deps（I/O 注入面）、被谁消费。
> **注意**：逐文件清单与行数可能滞后于代码（fallow 批次拆分过 cache/source/orchestrator 等），以 `src/` 实际代码为准。

通用规则：

- core 层禁 koishi 运行时 import（`scripts/check-size.ts` 强制），I/O 一律构造注入。
- 依赖方向单向向下：`environment`/`upload` 无内部依赖 → `deps`/`registry`/`racing` → `utils`；`install` 组合大部分模块；`market` 只依赖 `racing`/`utils`/`registry(manifest)`。
- 注释中标注「成块移植自旧 Xxx」的文件，算法与旧代码等价，只换了外壳。

## 目录

- [src/shared/（共享语言层）](#srcshared)
- [core/utils/（工具层）](#coreutils)
- [core/racing/（端点竞速）](#coreracing)
- [core/registry/（registry 元数据访问）](#coreregistry)
- [core/market/（市场索引源）](#coremarket)
- [core/deps/（依赖解析）](#coredeps)
- [core/install/（安装编排）](#coreinstall)
- [core/upload/（本地包上传）](#coreupload)
- [core/environment/（环境快照）](#coreenvironment)

## src/shared/

node 与 client 共用的类型与纯函数，包内以 `./shared` 入口单独导出。

| 文件 | 行数 | 关键导出 |
|---|---|---|
| `types.ts` | 98 | `RegistryStatus`、`MarketPerformanceSnapshot`、`MarketRouteScore`、`MarketPerformance`、`MarketLookupRequest/Result`、`MarketSnapshotRequest/Transfer/Response`、`MarketPayload` |
| `provider.ts` | 70 | `abstract class MarketProvider extends DataService<MarketPayload>`：抽象 `collect()`/`getSnapshot()`，可选 `probeInBackground?(reason)`，具体 `start(refresh)`/`prepare()`；声明 console 事件合并（`market/refresh` 等 ×4） |
| `bundle.ts` | 239 | `BUNDLE_KEYWORD = "market:package"`、`PluginBundleRecord` 等接口 ×10；`parseBundleManifest`/`validateBundleManifest`/`scanSensitiveConfig`/`isBundlePackageName`/`getBundleGroupIdent` 等函数 ×12 |
| `dependency-source.ts` | 166 | `DependencySource` 类型（8 种来源协议）；`classifyDependencySource`/`classifyRegistryNotFoundDependency`/`reuseConfirmedDependencySource`/`isLocalDependency`/`shouldPenalizeRegistryRoute` 等 ×11 |
| `update.ts` | 98 | `UpdateIgnoreRule`/`IgnoredUpdates`/`UpdateIgnorePolicy`；`getUpdateCandidates`/`isUpdateVersionIgnored`/`getLatestAllowedUpdate`/`parseUpdateIgnoredPackages` 等 ×7 |

## core/utils/

零依赖工具层。五个文件彼此独立、互不 import，被上层按需单点引入。

| 文件 | 行数 | 职责与导出 |
|---|---|---|
| `format.ts` | 59 | 展示格式化纯函数：`formatError`/`formatStack`/`shortHash`/`formatTime`/`formatAge`/`formatBytes`/`formatTimings`/`formatEndpointHost` 等 |
| `math.ts` | 8 | `clamp`、`finiteNumber` |
| `json-store.ts` | 61 | `class JsonStore<T>`：防抖 JSON 落盘（默认 2s）。`read()`（ENOENT/解析错误回退 undefined）、`schedule(getData)`（**写入时刻**才经 getData 求值，保证内存更新总会落盘）、`write(data)`、`dispose()`。直接用 `node:fs/promises` |
| `async.ts` | 18 | `sleep(ms)`、`waitFor(task, timeout)`（超时返回 false 不拒绝） |
| `time.ts` | 5 | `SECOND/MINUTE/HOUR/DAY` 毫秒常量（koishi `Time` 的纯等价物） |

**消费者**：market（最重）、install、racing、registry。

## core/racing/

端点竞速域——旧 `Installer` 与 `MarketProvider` 两套逐字等价的竞速实现在此合并，是 registry 与 market 共用的路由基础设施。

| 文件 | 行数 | 职责与导出 |
|---|---|---|
| `request-scope.ts` | 63 | `class RequestScope`：失效域。`advance(reason)`（serial++ 并 abort 在途）、`isStale(serial)`、`dispose()`、`track/untrack(controller)`；`isInternalAbort(error)`（正则判定竞速内部取消，不计端点失败）。构造注入 `{ isActive?: () => boolean }` |
| `race.ts` | 167 | `raceEndpoints<T>(params)`：主端点先行，超慢阈值或失败后 fallback 以 `i * stagger` 错峰加入，任一成功即结算并 abort 其余；返回 `RaceAttempt<T>`（含 `fallbackReason: "primary-failed" \| "primary-slow"`）。全部依赖经 params 注入（scope/fetch/回调） |
| `stats.ts` | 126 | `class RouteStatsBook`：端点学习统计（registry 与 market 字段超集）。`recordSuccess`（EWMA 0.7/0.3，失败数 ×0.6 衰减）、`recordFailure`、`get/reset`；`marketRouteCooldown(failures)` 冷却阶梯 60s→5m→30m→4h→12h。构造注入 `StatsPolicy`（两域各自提供策略） |
| `score.ts` | 69 | `routeScore(endpointStats, options)`：成功率/历史分/EWMA 延迟/近期成功/连续失败加权；`registryFallbackDelay`。成块移植自旧 `getRegistryRouteScore`/`getRouteScore`（共用核心，差异走 `extraScore`） |

**组装方式**：上层（registry/client/index、market/source/fetch-index）把四者拼成路由——scope 提供失效域 → stats 记录 → score 评估 → race 执行。

**消费者**：registry（全部 4 文件）、market（6 文件）、install/orchestrator 与 deps/resolver（RequestScope 类型）。

## core/registry/

npm registry 元数据访问完整栈。`client/index.ts` 是编排门面，其余文件是被组合的部件。

| 文件 | 行数 | 职责 |
|---|---|---|
| `client/index.ts` | 283 | `class RegistryClient`：路由编排门面。公开 `formatError`/`resetEndpoint`/`restoreStats`/`scheduleStatsWrite`/`getRouteScore`/`getFallbackDelay`/`getInstallFallbackCandidate`/`getRouteScores`/`ensureMetadataEndpoint`/`getRegistry`/`retryEndpoints`/`fetchByRoute`/`setMetadataEndpoint`；构造时自建 `RouteProbe`。常量 `REGISTRY_FALLBACK_ENDPOINTS`（npmmirror/腾讯/华为/npmjs/cnpmjs 五镜像） |
| `cache/index.ts` | 117 | `class PackageCache`：三层包版本缓存——`fullCache`（全量）/`tempCache`（增量广播用）+ `notFoundCache`（404 负缓存，5 分钟 TTL）+ `pkgTasks` 任务去重。`getPackage`/`setPackage`/`findVersion`/`flush`/`clear` |
| `client/fetch.ts` | 175 | `fetchRegistryWithRetry(name, serial, host)`：重试主循环（旧 `Installer.getRegistry` 主体）——statusSink 置 loading → 路由探测预热 → 逐轮竞速（轮间 300ms×(retry+1)）→ 失败归因合并上抛。经 `RegistryFetchHost` 结构化接口反向解耦 |
| `client/probe.ts` | 99 | `class RouteProbe`：每个后端生命周期一次的元数据路由探测（用一个探针包竞速全部候选端点，选出默认 `metadataEndpoint`），task 去重 |
| `client/endpoints.ts` | 114 | 路由纯函数：候选生成/按分排序/元数据端点降级判定（所选端点连续失败 ≥2 且分数差 >1 时回退主端点）/安装备用源推荐 `installFallbackCandidate` |
| `errors.ts` | 104 | 错误归因：任意异常 → `{reason, error}`（404→not-found、超时→timeout、ENOTFOUND→network、坏数据→invalid）；差异化扣分（not-found 0.4 / invalid 0.8 / http 1.2 / timeout·network 1.8）；多轮失败原因合并 |
| `manifest.ts` | 115 | `@koishijs/registry` Scanner 封装 + `loadManifest`（本地 package.json，`$workspace` 标记）+ `getVersions`（semver 降序 peer 摘要）+ `pickMetadataProbe` + `resolvePluginName`（短名双候选）+ `filterCompatibleVersions`（koishi satisfies "4"） |
| `cache/stats-file.ts` | 78 | 路由学习数据磁盘序列化/恢复（写盘分数收敛 [-6,3]；恢复 30 天 TTL） |

**RegistryClient 构造 deps**（P3 接线对照）：

```ts
{
  httpFactory: (endpoint) => RegistryHttpClient,   // ctx.http.extend
  isHttpError: (error) => boolean,                 // cordis HTTP.Error 判定
  stats: RouteStatsBook, statsFile: JsonStore,
  scope: RequestScope,
  defaultEndpoint: () => Promise<string>,          // 接 getRegistry()
  statusSink: (name, status, serial) => void,      // 接 registryStatus 通道刷新/广播
  log,
}
```

**已知瑕疵**（P6 收尾可顺手修）：`endpoints.ts ↔ client.ts` 存在模块级循环值导入；`fetch.ts` 私有重复实现了 `sleep` 未复用 `utils/async`。

## core/market/

市场索引源。`source/index.ts` 是门面，从旧 `node/MarketProvider` 剥离 DataService 壳后的主体。

| 文件 | 行数 | 职责 |
|---|---|---|
| `source/index.ts` | 385 | `class MarketIndexSource`：状态 + 拉取编排 + collect + start。公开 `collect()`/`start(refresh)`/`getSnapshot()`/`fetchAndApply`/`applyIndex`/`probeInBackground`/`warmDiskCache`/`flushPatch`/`scoreContext` 等；持有 `scope`/`stats`/`cache`/`scanner`/`background` |
| `source/background.ts` | 116 | `class MarketBackgroundRefresher`：refresh/probe 后台编排（refreshInBackground / probeInBackground） |
| `cache/index.ts` | 334 | `class MarketDiskCache`：磁盘缓存 v3 拆分布局（`MAX_CACHE_ENTRIES=3`，TTL 30 天）+ 路由统计共储 + 原子写 + legacy 内联缓存迁移 |
| `source/fetch-index.ts` | 126 | `fetchMarketIndex(deps, serial)`：活跃端点竞速（`ROUTE_STAGGER=80ms`，`FAST_ROUTE_THRESHOLD=500ms`），全败后启用冷却端点救援 |
| `source/fetch-endpoint.ts` | 182 | `fetchMarketEndpoint`：单端点条件请求（etag/last-modified → 304 复用）→ 内容哈希比对复用 → 解析 |
| `source/endpoints.ts` | 106 | 默认端点 `https://registry.koishi.t4wefan.pub/index.json` + `FALLBACK_ENDPOINTS`（11 镜像）；市场评分（缓存新鲜度 + 压缩编码加分）/冷却判定/竞速与救援候选 |
| `snapshot.ts` | 203 | `buildMarketSnapshot(host)`：getSnapshot 组装——后台任务复用 → 缓存 payload → 磁盘预热等待 → 首次网络限时 1500ms → 错误降级 |
| `source/host.ts` | 69 | `createSourceSnapshotHost(source)`（把 source 适配为 SnapshotHost）+ `performanceFrom(result, objects)` |
| `cache/normalize.ts` | 98 | 磁盘缓存归一化 + legacy 检测（触发迁移） |
| `format.ts` | 57 | 快照/评分/缓存条目的单行日志格式化 |
| `types.ts` | 59 | `EndpointResult`、`CacheEntry`（v3 条目）、`CacheStore`（version 3）等 |

**MarketIndexSource 构造 deps**（P3 的 MarketProvider 直接构造它）：

```ts
{
  http: (endpoint) => HTTP,                 // ctx.http.extend({ endpoint, timeout })
  scannerRequest: (url, config) => ...,     // ctx.http.get
  cacheFile, cacheDir,                      // resolve(ctx.baseDir, 'cache', 'market-next-index*')
  log,
  notifyRefresh: () => ...,                 // ctx.console.refresh('market')
  broadcastPatch: (payload) => ...,         // ctx.console.broadcast('market/patch', ...)
  onRegistryVersions: (name, versions) => ...,  // installer.setPackage
}
```

## core/deps/

| 文件 | 行数 | 职责 |
|---|---|---|
| `resolver.ts` | 240 | `class DependencyResolver`：宿主 package.json 依赖快照（`getLocalDepsSnapshot`，逐个 loadManifest 解析 resolved/workspace + 来源分类）、latest 并发刷新（`refreshDependencyMetadata`，p-map 并发 + depTask 去重）、全路由 404 归类为未绑定本地插件、`reload()`（轻量，安装回滚后）与 `resetForRefresh()`（全量）两档重建 |
| `types.ts` | 27 | `interface Dependency`（request/resolved/workspace/source/local/bound/invalid/latest）——dependencies 通道的值类型 |

**构造 deps**：`{ cwd: () => string, cache: PackageCache, scope, concurrency: () => number | undefined, formatError, ensureProbe, log, onMetadataRefreshed }`。后两者分别接 registry.formatError / registry.ensureMetadataEndpoint / console.refresh('dependencies')。

## core/install/

安装域。`pipeline/orchestrator.ts` 是核心，组合 queue/runner/planner/manifest-restore/logs 并横向联动 deps/registry/environment/upload。

| 文件 | 行数 | 职责 |
|---|---|---|
| `pipeline/orchestrator.ts` | 372 | `class InstallOrchestrator`：安装编排状态机。公开 `install`/`installLocked`/`refreshDependencyState`/`captureCurrentEnvironmentSnapshot`/`recordCurrentEnvironmentSnapshot`/`isInstalling`。主流程见下节 |
| `pipeline/queue.ts` | 33 | `class InstallQueue`：串行锁（`withLock(description, callback)`），同一时刻只允许一个安装/环境恢复在跑 |
| `pipeline/runner.ts` | 134 | `runPackageManager(args, deps)`：execa v10 适配——`execa(name, args, { cwd, reject: false })` + stdout/stderr 流式逐行转发（yarn berry `--json` 走 exec-parse）；agent 信息需外部 `await detect()` 后注入（修复旧代码未 await 的 bug） |
| `pipeline/exec-parse.ts` | 18 | `yarnLogLevel(type)`：yarn berry --json 日志类型 → logger 级别 |
| `pipeline/planner.ts` | 67 | 纯函数：`formatDeps`/`createInstallHistoryChanges`/`requiresPackageManager`（判定是否需要真的跑包管理器） |
| `sources/manifest-restore.ts` | 98 | package.json 快照/合并覆写/失败回滚/写盘；`resolveLocalDeps`（本地依赖状态解析） |
| `environment.ts` | 78 | `class EnvironmentSnapshotOps`：环境快照列表/预览/恢复入口（复用 orchestrator 的 capture 与 installLocked） |
| `sources/upload.ts` | 210 | `class LocalPackageUploadService`：本地上传会话门面（start/append/finish/commit/cancel）+ `prepareLocalBinding`（npm pack --ignore-scripts + sha256 文件名 + 路径校验） |
| `types.ts` | 63 | `InstallLogger`、`InstallOptions`、`InstallHistory*`、`InstallLogDetail`、`LocalBindingResult` 等 |
| `logs/store.ts` | — | `class InstallLogStore`：单次安装会话日志写盘（时间戳+流标记、ANSI 清洗 `sanitizeInstallLogText`、广播、`.log.json` 元数据、waitForWrite） |
| `logs/reader.ts` | — | `getInstallHistory(limit, deps)` / `getInstallLogDetail(id, deps)`：元数据优先，回退 legacy 正则解析，大文件头尾截断（head 8KiB / tail 32KiB / 详情上限 512KiB） |
| `logs/retention.ts` | — | 日志目录定位（`market-next-install-logs/`）、保留时长解析、过期清理（跳过活跃会话） |

**InstallOrchestrator 构造 deps**（后六个回调是 P3 接到 Koishi 的接线点，具体接法以 `src/node/` 实际代码为准）：`{ cwd, log, config, scope, registry, packages, resolver, environments, queue, logs, agent, refreshChannels, refreshDependenciesChannel, clearRegistryStatus, fullReload, isActive, isPackageLoaded }`

**installLocked 主流程**（成块移植自旧 `_installLocked`，算法未改）：

```
manifest 快照 → 环境快照(前,容错) → 日志启动(容错) → 必要性判定
→ 来源校验（unbound 本地插件 → 阻断）→ 写 package.json
→ 包管理器（失败 → 回滚 manifest + resolver.reload + 刷新通道 + 提前返回 code）
→ 刷新依赖状态（scope.advance + resetEndpoint + 清状态 + resetForRefresh）
→ 变更对比（已加载包版本/本地请求变化 → shouldReload）
→ beforeReload 钩子 → 环境快照(后,容错) → shouldReload 时延迟 1s fullReload
→ finally: logs.finish（成功时回填 afterResolved，状态写 .log.json）
```

## core/upload/

本地包上传域（被 `install/sources/upload.ts` 消费）。

| 文件 | 行数 | 职责 |
|---|---|---|
| `session.ts` | 298 | `class LocalPackageUploadStore`：分块上传会话——512KiB/片 base64 严格顺序写入、TTL 15 分钟过期清理、`finish` 解包校验缓存、`commit` 哈希对比 + rename 原子落位 `.yarn/local/`。构造注入 `{ baseDir, warn }` |
| `tar.ts` | 112 | 归档安全：防解压炸弹（8192 条目 / 256MiB）、路径穿越、符号链接；读根部 package/package.json 校验插件名/版本；`readFileHash`、`createCanonicalLocalPackageFilename` |
| `local-binding.ts` | 60 | npm pack --json 输出解析、哈希文件名构造、`file:.yarn/local/xxx.tgz` 请求串构造（严格文件名校验）；`MAX_LOCAL_BINDING_PACK_SIZE = 64MiB` |
| `types.ts` | 66 | 上传协议类型（Start/Chunk/Finish/Commit/Preview）+ `getLocalPackageOperation`（install/upgrade/downgrade/replace 语义判定） |

## core/environment/

环境快照域（纯模型层，被 install 侧消费）。

| 文件 | 行数 | 职责 |
|---|---|---|
| `snapshot.ts` | 220 | 快照模型（依赖集合 → sha256 前 20 位 ID，`env-` 前缀）+ `class EnvironmentSnapshotStore`（上限 60 条、lastSeenAt 排序、原子写落盘 `data/market-next-environment-snapshots.json`） |
| `diff.ts` | 104 | `getEnvironmentDiff(current, target)`：逐依赖差异（upgrade/downgrade/added/removed/changed/unchanged/unsupported）；`getEnvironmentInstallChanges`（diff → 安装请求变化） |
| `apply.ts` | 34 | `planEnvironmentApply`：恢复前纯规划（diff + 不可恢复项 + 安装请求变化）；`buildEnvironmentDependencies` |

## 模块间依赖全景

```
shared (dependency-source / types)
  ↑
utils ──(math/time)──► racing
  ↑                      ↑
registry ◄───────────────┤（racing + utils）
  ↑                      │
deps ────────────────────┘
  ↑
environment / upload（叶子，仅依赖 shared）
  ↑
install（组合器：deps/registry/racing/environment/upload + install 内部全家）
market（独立支线：racing + utils + registry(manifest)）
```

> 唯一已知例外：registry 内部 `endpoints.ts ↔ client.ts` 循环值导入（见 registry 节"已知瑕疵"）。
