# @koishi-ce/plugin-hmr

**简体中文** | [English](#english)

Koishi 的插件热重载（Hot Module Replacement）插件，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/hmr`，开发环境专用。它以 `watcher` 服务监听文件变动，按影响范围选择最小代价的更新方式：能局部重载的只重载受影响插件，必须整体重启的才请求守护进程重启。TypeScript 源码无需预编译——loader 会经 esbuild 即时编译。

## 触发方式（三类）

1. **配置文件与环境文件变动**：热更新应用配置；无法热更新时请求整体重启；
2. **框架自身依赖变动**（不属于任何插件的模块）：整体重启；
3. **插件源码变动**：分析 require 依赖图，仅清理受影响插件的模块缓存并局部重载；失败时回滚模块缓存与插件状态，不影响运行中的应用。

每次重载前发出 `hmr/reload` 事件；esbuild 编译错误会经 @babel/code-frame 生成语法高亮的代码帧写入日志，直接定位出错行列。

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `root` | string / string[] | `["."]` | 要监听的文件或目录列表 |
| `ignored` | string / string[] | `["**/node_modules/**", "**/.git/**", "**/logs/**"]` | 忽略规则，支持 Glob 语法 |
| `debounce` | number | 100 | 延迟触发更新的等待时间（毫秒） |
| `base` | string | 当前工作路径 | 用户显示路径的根目录 |

另继承 chokidar 的监听选项（Config 接口）。

## 用法

```bash
bun add @koishi-ce/plugin-hmr
```

```yaml
# 通常由脚手架在 develop 分组预写，生产环境不启用
plugins:
  hmr:
    root: ["."]
```

以 `NODE_ENV=development koishi start` 启动时自动生效。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

Hot Module Replacement for Koishi plugins, ported from `plugins/hmr` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi), for development use only. It watches files as the `watcher` service and picks the cheapest update strategy per change: plugin-local reloads when possible, a full restart only when required. TypeScript sources need no precompilation — the loader compiles them on the fly with esbuild.

## Reload strategies (three kinds)

1. **Config or env file changes** — hot-update the app config; request a full restart when a hot update is impossible.
2. **Framework dependency changes** (modules not owned by any plugin) — full restart.
3. **Plugin source changes** — analyze the require graph, evict only the affected plugin's module cache and reload it; on failure, roll back the cache and the plugin state, leaving the running app untouched.

A `hmr/reload` event fires before each reload; esbuild compile errors are rendered as syntax-highlighted code frames (via @babel/code-frame) in the log, pinpointing the failing line and column.

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | string / string[] | `["."]` | Files or directories to watch |
| `ignored` | string / string[] | `["**/node_modules/**", "**/.git/**", "**/logs/**"]` | Ignore rules with Glob syntax |
| `debounce` | number | 100 | Debounce wait in milliseconds |
| `base` | string | current working path | Root directory for user-facing paths |

Chokidar watch options are also accepted.

## Usage

```bash
bun add @koishi-ce/plugin-hmr
```

```yaml
# Usually prewritten in the develop group by the scaffold; not enabled in production
plugins:
  hmr:
    root: ["."]
```

Active automatically when started with `NODE_ENV=development koishi start`.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
