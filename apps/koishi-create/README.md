# create-koishi-ce

**简体中文** | [English](#english)

Koishi CE 生态的项目脚手架。一条命令生成以 Bun 为运行时、纯 `@koishi-ce` 依赖的完整机器人项目：预装常用插件、钉住上游包名 alias、预写分组配置，开箱即可 `koishi start`。

```bash
bunx create-koishi-ce my-app
# 或
npm create koishi-ce my-app
```

## 选项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `[名称]` | 交互询问（初始值 koishi-app） | 项目名，同时作为目标目录名 |
| `-t, --template <名称>` | 内置模板 | 改用 npm registry 上的远程模板包（逃生舱） |
| `-r, --ref <引用>` | latest | 远程模板的版本引用 |
| `-f, --forced` | - | 强制清空目标目录 |
| `-g, --git` | - | 初始化 git 仓库（分支取 init.defaultBranch，未配置则 main） |
| `--registry <地址>` | 参数 > npm_config_registry > .npmrc > 官方源 | npm registry |
| `-p, --prod` | - | 生产模式：删除模板的 workspaces 与 devDependencies |
| `-y, --yes` | - | 跳过全部询问（含跳过依赖安装） |

交互流程：项目名；目标目录非空时确认是否清空；最后确认是否立即安装依赖并启动（包管理器一律使用 Bun）。

## 生成的项目

- **package.json**：`type: module`、`packageManager` 钉 Bun、workspaces 含 `plugins/*` 与 `external/*`；dependencies 预装全套 `@koishi-ce` 常用插件（console、config、market、auth、admin、help、sandbox 等），并预置四行 npm alias 钉住上游名——`koishi` / `@koishijs/core` / `@koishijs/loader` 指向 `@koishi-ce/koishi-shim`、`@koishijs/plugin-console` 指向 `@koishi-ce/console-shim`，社区插件由此全部解析到 CE 框架；
- **koishi.yml**：按 server（端口 5140-5149）/ basic / console（自动打开、市场指向 registry.koishi.chat 镜像）/ storage / adapter / develop（开发模式启用热重载）分组预写；官方 adapter / database 插件以 `~` 停用条目预写，可按需启用；
- **开发工具链**：devDependencies 预置 `@koishi-ce/client`、`@koishi-ce/plugin-hmr` 与 `@koishi-ce/scripts`（`koishi-scripts setup` 可在 external/ 下继续创建插件项目）。

不预装任何 adapter 与 database——官方版本可后续从市场安装，peer 已被 alias 钉住不会形成双实例。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)，本仓库原创作品，版权归 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The project scaffold for the Koishi CE ecosystem. One command generates a complete bot project on the Bun runtime with pure `@koishi-ce` dependencies: common plugins preinstalled, upstream-name aliases pinned, grouped config prewritten — ready for `koishi start` out of the box.

```bash
bunx create-koishi-ce my-app
# or
npm create koishi-ce my-app
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `[name]` | prompted (initial koishi-app) | Project name, also the target directory |
| `-t, --template <name>` | built-in template | Use a remote template package from the npm registry (escape hatch) |
| `-r, --ref <ref>` | latest | Version ref of the remote template |
| `-f, --forced` | - | Force-clean the target directory |
| `-g, --git` | - | Initialize a git repository (branch from init.defaultBranch, fallback main) |
| `--registry <url>` | arg > npm_config_registry > .npmrc > official | npm registry |
| `-p, --prod` | - | Production mode: drop workspaces and devDependencies from the template |
| `-y, --yes` | - | Skip all prompts (including dependency installation) |

Interactive flow: project name; confirm cleaning a non-empty target directory; confirm installing dependencies and starting right away (Bun is always the package manager).

## Generated project

- **package.json** — `type: module`, `packageManager` pinned to Bun, workspaces covering `plugins/*` and `external/*`; dependencies preinstall the common `@koishi-ce` plugin set (console, config, market, auth, admin, help, sandbox, etc.) plus the four npm-alias lines pinning the upstream names (`koishi` / `@koishijs/core` / `@koishijs/loader` to `@koishi-ce/koishi-shim`, `@koishijs/plugin-console` to `@koishi-ce/console-shim`), so community plugins all resolve to the CE framework.
- **koishi.yml** — grouped prewrites for server (ports 5140-5149), basic, console (auto-open, market pointed at the registry.koishi.chat mirror), storage, adapter and develop (HMR in development mode); official adapter / database plugins are prewritten as `~`-disabled entries.
- **Toolchain** — devDependencies include `@koishi-ce/client`, `@koishi-ce/plugin-hmr` and `@koishi-ce/scripts` (`koishi-scripts setup` scaffolds further plugin projects under external/).

No adapter or database is preinstalled — official ones can be installed from the market later; their peers are already pinned by the aliases.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE), original work of this repository, copyright Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
