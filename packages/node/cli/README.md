# @koishi-ce/koishi

**简体中文** | [English](#english)

Koishi 的社区再发行版（Community Edition）主包与命令行宿主，来自 [Koishi-CE/koishi](https://github.com/Koishi-CE/koishi)——将上游 [koishijs/koishi](https://github.com/koishijs/koishi) 与 [koishijs/webui](https://github.com/koishijs/webui) 合并重构的单一 Bun workspace 单仓库。本包入口与上游 `koishi` 主包同构：合并再导出 [`@koishi-ce/core`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/core) 与 [`@koishi-ce/loader`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/loader)，并内置 `koishi` 命令与守护进程。

命令名保持为 `koishi`，与上游用法一致。本项目与 Koishijs 官方组织无从属关系，感谢原作者 Shigma 及所有上游贡献者，相关声明见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) 与 [docs/UPSTREAM.md](https://github.com/Koishi-CE/koishi/blob/main/docs/UPSTREAM.md)。

## 安装与启动

```bash
npm install -g @koishi-ce/koishi
koishi start
```

更推荐用脚手架创建完整项目（自带控制台、市场与热重载配置）：

```bash
bunx create-koishi-ce my-app
```

## 命令行

| 命令 | 说明 |
| --- | --- |
| `koishi start [file]`（别名 `run`） | 启动应用，`file` 为配置文件路径 |

选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--debug [namespace]` | - | 开启调试日志，可限定命名空间 |
| `--log-level [level]` | 2 | 日志等级 |
| `--log-time [format]` | - | 日志时间戳格式 |

不带子命令运行 `koishi` 时输出帮助。

## 守护进程机制

`koishi start` 是守护父进程：以 Bun.spawn 拉起工作进程并保持 IPC 心跳，心跳超时强制终止。退出码约定：51 = 工作进程请求整体重启（配置文件或框架依赖变更），52 = 请求退出。工作进程内由 loader 读取配置、预检服务器端口（被占则干净退出）、创建应用并挂载 daemon 插件。

## 编程式用法

```ts
import { App, defineConfig, NodeLoader } from "@koishi-ce/koishi";
```

对 `koishi` / `@koishijs/core` / `@koishijs/loader` 三个上游名的兼容由 [`@koishi-ce/koishi-shim`](https://github.com/Koishi-CE/koishi/tree/main/packages/shim) 以 npm alias 承担，社区插件无需改动即可在 CE 项目中运行，详见 [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The Community Edition main package and CLI host of Koishi, from [Koishi-CE/koishi](https://github.com/Koishi-CE/koishi) — a single Bun-workspace monorepo merging the upstream [koishijs/koishi](https://github.com/koishijs/koishi) and [koishijs/webui](https://github.com/koishijs/webui). Its entry mirrors the upstream `koishi` package: a merged re-export of `@koishi-ce/core` and `@koishi-ce/loader`, plus the `koishi` command and a daemon. Not affiliated with the Koishijs organization; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) and [docs/UPSTREAM.md](https://github.com/Koishi-CE/koishi/blob/main/docs/UPSTREAM.md).

## Installation

```bash
npm install -g @koishi-ce/koishi
koishi start
```

Or scaffold a full project (console, market and HMR preconfigured):

```bash
bunx create-koishi-ce my-app
```

## CLI

`koishi start [file]` (alias `run`) starts the app, with options `--debug [namespace]`, `--log-level [level]` (default 2) and `--log-time [format]`. Running `koishi` without a subcommand prints help.

The `start` command is a daemon parent: it spawns the worker via Bun.spawn with IPC heartbeats. Exit code 51 asks for a full restart, 52 asks to quit. The worker reads the config through the loader, prechecks server ports, creates the app and mounts the daemon plugin.

## Programmatic usage

```ts
import { App, defineConfig, NodeLoader } from "@koishi-ce/koishi";
```

Compatibility with the upstream names `koishi` / `@koishijs/core` / `@koishijs/loader` is provided by `@koishi-ce/koishi-shim` via npm aliases, so community plugins run unmodified in CE projects — see [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md).

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
