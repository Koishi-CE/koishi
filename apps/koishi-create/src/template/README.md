# Koishi 机器人项目

由 `bun create koishi-ce` 生成，运行于 [@koishi-ce 社区再分发版](https://github.com/Koishi-CE/koishi) 生态。

## 环境要求

- [Bun](https://bun.sh) ≥ 1.2（本项目唯一支持的运行时与包管理器：koishi CLI 与插件加载链均以 Bun 为准）

## 快速开始

```bash
bun install
bun run start        # 启动（生产模式）
bun run dev          # 启动（开发模式，启用 HMR 热更新）
```

启动后访问控制台：<http://127.0.0.1:5140>

## 预装与预写

- **已预装**：基础与控制台插件（@koishi-ce 全家桶）。`koishi.yml` 为配置页导出形态：插件键带 uid 实例后缀，分组带中文 `$label` 标签。其中依赖数据库但非必需的（admin / bind / broadcast / callme / auth）与暂无需启用的（inspect / server-temp / mock）以 `~` 前缀保持禁用——数据库已默认启用，去掉对应 `~` 即可。
- **数据库开箱即用**：`@koishi-ce/plugin-database-sqlite` 已预装并默认启用，数据落在 `data/koishi.db`。
- **只预写、未预装**：adapter（discord / telegram / qq …）官方插件以 `~` 禁用条目预写在 `koishi.yml` 的 `group:adapter`——loader 会跳过禁用条目，不安装也能正常启动；需要时在控制台「插件市场」搜索安装，回到配置页点击启用即可（mongo / mysql / postgres 等其他数据库插件未预写占位，市场安装后自动出现条目）。

## 安装插件

推荐在控制台「插件市场」页安装（已预配 registry.koishi.chat 镜像源）；也可以手动 `bun add <包名>` 后在 `koishi.yml` 中启用。

根依赖中的四行 npm alias——`"koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"`、`"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11"`、`"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"`——已把上游生态的 peer 依赖全部钉回 @koishi-ce 框架（前两行与后两行分别只涉及 koishi-shim / console-shim 两个包；**请勿删除或改写这四行**），不会形成第二份框架 / console / loader 副本。

## 自定义插件

在 `plugins/` 目录下创建插件包（可用 `bun run new <名称>` 生成骨架），在 `koishi.yml` 中以相对路径引用（如 `./plugins/my-plugin`）即可启用；Bun 直接加载 TypeScript 源码，无需预编译。
