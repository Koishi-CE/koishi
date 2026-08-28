# 架构总览

> 状态：P0–P4 已完成（shared / core / node 适配层 / client 全部建成），P5（宿主联调）进行中。本文描述**目标架构**，以 `src/` 与 `client/` 实际代码为准。

## 1. 一图总览

```
┌─────────────────────────────────────────────────────────────┐
│  宿主 Koishi 应用（yarn workspace，koishi.yml 加载本插件）      │
└─────────────────────────────────────────────────────────────┘
        │ 加载                          │ console 通道 / RPC / 广播
┌───────────────────────┐     ┌─────────────────────────────┐
│  src/node/  (P3)      │     │  client/  (P4)              │
│  Koishi 适配层         │◄───►│  Console 前端（Vue 3）        │
│  Service 门面/DataService/  │  pages / dialogs / lib       │
│  listeners / commands       │                              │
└──────────┬────────────┘     └─────────────────────────────┘
           │ 构造注入（deps 对象）
┌──────────▼──────────────────────────────────────────────┐
│  src/core/  ✅ 已建成                                    │
│  领域层：禁 koishi 运行时 import，I/O 构造注入             │
│  utils / racing / registry / market / deps /             │
│  install / upload / environment                          │
└──────────┬──────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────┐
│  src/shared/  ✅ 已建成                                  │
│  共享语言层：node 与 client 共用的类型与纯函数              │
│  types / provider / bundle / dependency-source / update  │
└─────────────────────────────────────────────────────────┘
```

## 2. 分层与职责

### src/shared —— 共享语言层 ✅

node 端与 client 端**共用**的类型与纯逻辑，随包以 `./shared` 入口单独导出（client 直接 import）：

| 文件 | 职责 |
|---|---|
| `types.ts` | 市场通道 payload、性能快照、`RegistryStatus`、lookup/snapshot 协议类型 |
| `provider.ts` | `MarketProvider` 抽象基类（继承 DataService，声明 console 事件合并）——**shared 中唯一依赖 koishi 运行时之处** |
| `bundle.ts` | 插件捆绑包（`market:package`）清单解析/校验/命名约定/敏感配置扫描 |
| `dependency-source.ts` | 依赖来源协议分类（file/link/portal/workspace/git/url/registry/unbound）与本地插件判定 |
| `update.ts` | 更新忽略策略（按版本/次数/期限/包名）与候选计算 |

### src/core —— 领域层（六边形内核）✅

全部业务逻辑，**禁 koishi 运行时 import**（仅允许 `import type { Dict } from "koishi"`；`Context/Service/Logger/HTTP/Time/Schema` 一律不进 core）。所有 I/O（HTTP、文件、广播、刷新、重载）通过**构造函数注入 deps 对象**。8 个模块：

| 模块 | 职责 | 详见 |
|---|---|---|
| `utils/` | 零依赖工具：格式化、数值、防抖 JSON 落盘（`JsonStore`）、异步、时间常量 | [CORE-MODULES](CORE-MODULES.md#coreutils) |
| `racing/` | 端点竞速基础设施：`RequestScope`（serial 陈旧性 + AbortController）、`raceEndpoints`（错峰竞速）、`RouteStatsBook`（学习统计）、`routeScore`（评分） | [→](CORE-MODULES.md#coreracing) |
| `registry/` | npm registry 元数据访问完整栈：多端点路由、重试、三层缓存、404 负缓存、路由探测 | [→](CORE-MODULES.md#coreregistry) |
| `market/` | 市场索引源：11 端点竞速拉取、磁盘缓存（v3 拆分布局）、后台刷新、快照组装 | [→](CORE-MODULES.md#coremarket) |
| `deps/` | 依赖解析：宿主 package.json 快照、latest 并发刷新、未绑定本地插件归类 | [→](CORE-MODULES.md#coredeps) |
| `install/` | 安装编排：串行锁、package.json 快照/回滚、包管理器执行、安装日志三件套、环境快照操作、本地上传门面 | [→](CORE-MODULES.md#coreinstall) |
| `upload/` | 本地 .tgz 分块上传会话、tar 安全校验、本地绑定（npm pack） | [→](CORE-MODULES.md#coreupload) |
| `environment/` | 环境快照模型、diff、恢复规划（纯函数） | [→](CORE-MODULES.md#coreenvironment) |

### src/node —— Koishi 适配层 ✅

只做「把 core 组装成 Koishi 服务」：zod 契约校验、`Installer` 服务门面（public 签名与旧版不变）、5 个 DataService、23 个 RPC listener、4 个命令、头像代理、快照 HTTP 传输、空闲探测。**不含业务逻辑**——业务逻辑全部下沉 core。实际结构为 `installer/`、`config/`、`console/`、`avatar/`、`locales/` 等扁平布局。

### client —— Console 前端 ✅

feature-first 组织：`app/`（pages/actions/registry-state）、`pages/`（market、dependencies）、`dialogs/`（安装/捆绑/历史/环境等对话框）、`components/`（dependency-card 等）、`extensions/`、`market/`、`shared/`。全部 `<script setup lang="ts">`，样式出仓到同目录 `.scss`。

## 3. 依赖方向规则（工具强制）

```
client ──► shared（经包名 ./shared 与类型导入）
node  ──► core ──► shared
node  ──► shared
```

- **core 禁 koishi**：`scripts/check-size.ts` 的 `checkCoreImports` 逐行 grep 校验——`from 'koishi'` 与 `from '@koishijs/*'`（`@koishijs/registry` 例外，框架无关的领域扫描器）只允许出现在 `import type` 行。
- **core 内部单向向下**：`environment`、`upload` 无内部依赖；`install` → `deps`/`registry`/`racing`/`environment`/`upload`；`market` → `racing`/`utils`/`registry(manifest)`；不允许反向。
- **shared 零 I/O**（provider.ts 除外）。

## 4. 关键机制

### 4.1 端点竞速（racing 三件套）

旧代码里 `Installer` 与 `MarketProvider` 各有一套逐字等价的竞速实现，重构合并为 `racing/` 一处：

- **`RequestScope`**：失效域。每次全量刷新 `advance()` 使 serial 递增并 abort 所有在途请求；`isStale(serial)` 判定结果是否已过期。P3 接线时把 `isActive` 接到 `ctx.scope.isActive`。
- **`RouteStatsBook`**：按端点学习——成功率、EWMA 延迟（0.7/0.3）、连续失败惩罚、市场端点冷却阶梯（60s → 5m → 30m → 4h → 12h）。
- **`raceEndpoints()`**：主端点先行，超过慢阈值（registry 按学习动态、市场固定 500ms）或失败后，fallback 端点以 80ms 错峰加入；任一成功即结算并 abort 其余。

registry 侧另有 5 个 npm 镜像 fallback（npmmirror/腾讯/华为/npmjs/cnpmjs），市场侧 11 个索引镜像。路由统计数据持久化到 `cache/market-next-registry-stats.json`（30 天 TTL 恢复）。

### 4.2 安装编排（install/pipeline/orchestrator.ts）

`_installLocked` 主流程（P2 已移植，算法未改）：

```
取串行锁 → package.json 快照 → 环境快照(前) → 启动安装日志
→ 来源校验（unbound 本地插件为阻断项）→ 写 package.json
→ 执行包管理器（失败 → 回滚 manifest + reload + 提前返回）
→ 刷新依赖状态 → 变更对比（判定 fullReload）→ beforeReload 钩子
→ 环境快照(后) → 延迟 1s 全量重载 → finally 收尾日志
```

### 4.3 契约冻结

对外行为面（重构前后必须逐项一致，验收清单见 [P5-P6-联调验收与收尾.md](P5-P6-联调验收与收尾.md)）：

- DataService 通道 ×5：`market` / `dependencies` / `registry` / `registryStatus` / `marketData`
- RPC listener ×23（`market/` 前缀，全部 authority 4）
- 广播 ×5：`market/patch`(500ms) / `market/registry`(500ms) / `market/registry-status`(200ms) / `market/registry-status/clear` / `market/install-log`
- HTTP ×1：`GET {uiPath}/market-next/snapshot/:id`（gzip + ETag + immutable）
- 命令 ×4：`plugin.install(.i)` / `plugin.uninstall(.r)` / `plugin.upgrade(.update/.up)` / `plugin.clear-avatar-cache`
- 磁盘路径：`data/market-next*.json`、`data/market-next-install-logs/`、`cache/market-next-*`、`.yarn/local/` + `file:.yarn/local/xxx.tgz` 请求串

完整契约面（含每个 RPC 的参数/返回/旧代码行号）：[reference/前后端调用契约.md](reference/前后端调用契约.md)。

## 5. 构建产物

| 产物 | 工具 | 入口 → 输出 | 说明 |
|---|---|---|---|
| 服务端 | tsdown | `src/node/index.ts` → `lib/node/`；`src/shared/index.ts` → `lib/shared/` | CJS + d.ts（package.json `main`/`exports` 指向 `lib/node/index.cjs`）；package.json exports 的 development 条件指向 src（宿主无 `--conditions development`，**验证前必须先构建 lib/**） |
| 前端 | vite 8 | `client/index.ts` → `dist/` | 配置逐项对齐 `@koishijs/client` 官方打包（external/alias/unocss preset-mini），保证与宿主 dev 模式（宿主内置 vite 5）行为一致；CSS 产物固定 `style.css`（prod console 只探测它） |

构建链路与宿主加载机制的完整考据：[reference/构建与宿主接线.md](reference/构建与宿主接线.md)。

## 6. 与旧代码的关系

`参考/` 与 `原版参考/` 是逻辑移植来源（重构过程参照与原版快照，**只读勿改**），P6 阶段删除。重构约定：逻辑成块移植不发明、只换外壳（I/O 注入）；契约面保持不变（见 §4.3）；已知旧 bug（如 agent 检测未 await）在移植时修复。
