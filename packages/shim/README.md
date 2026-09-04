# packages/shim

本目录集中存放**上游包名占位 shim**（纯 JS 预编译包，无 `src/`、不走根 tsdown 构建、版本冻结、changesets ignore）。

这些包本身不实现任何功能，只做一件事：**以 npm alias 的形式占用上游包名，把依赖树中对上游名的解析指回本仓对应的 `@koishi-ce/*` 包**，从而阻止包管理器与市场运行时自动安装 npm 官方包，避免形成第二份框架 / console 副本。

## 为什么需要 shim

本仓框架包名是 `@koishi-ce/koishi`（core + loader 合并再分发），而社区插件生态（上游官方 adapter / database 插件与 `koishi-plugin-*`）的 `peerDependencies` 指向上游名（`koishi` / `@koishijs/core` / `@koishijs/loader` / `@koishijs/plugin-console`）。

下游项目如果不占住这些名字，任何一次 `bun add`（或市场运行时安装）都会因 peer 无归属而让 Bun 自动装下 npm 官方全家桶，与 CE 框架形成双实例，破坏 cordis 对象身份与 `instanceof` 语义。

workspace 内部不需要这些 shim（本仓代码一律直接 `import ... from "@koishi-ce/*"`，root 也无需为上游名声明依赖）；shim 的服务对象是**下游项目**——由 `create-koishi-ce` 生成、以 Bun 为运行时的 CE 实例。

## 包列表

| 包名 | 版本 | 占用的上游名 | re-export 源 |
| --- | --- | --- | --- |
| `@koishi-ce/koishi-shim` | 4.18.x 冻结线 | `koishi` / `@koishijs/core` / `@koishijs/loader` | `@koishi-ce/koishi` |
| `@koishi-ce/console-shim` | 5.30.x 冻结线 | `@koishijs/plugin-console` | `@koishi-ce/plugin-console` |

### koishi-shim 一名兼三

`@koishi-ce/koishi` 是 core + loader 两包的合并再导出，与上游 `koishi` 主包入口同构，因此对三个名字的上游消费者而言 named 导出全覆盖（`Loader` / `Context` / `Session` / `Schema` / `h` / `z` 等），且经同一 re-export 源保证模块实例全局唯一。

已知缺口（刻意接受）：`import NodeLoader from "@koishijs/loader"` 形态的 default 导出经本 shim 不可达（ESM `export *` 不传播 default）。上游插件生态无此用法（loader 是宿主概念，插件不消费其 default），需要 default 的本仓代码一律直接 `import ... from "@koishi-ce/loader"`。

## 使用方式（下游项目）

下游项目在 `package.json` 中以 npm alias 钉名（`create-koishi-ce` 模板已预置，请勿删除或改写）：

```jsonc
{
  "dependencies": {
    "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11",
    "@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11",
    "@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11",
    "@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"
  }
}
```

前两行与后两行分别只涉及 koishi-shim / console-shim 两个包。社区插件的 peer（`koishi ^4.x`、`@koishijs/plugin-console ^5.30.x` 等）经此全部钉回 CE 框架，不会形成第二份框架 / console 副本。

## 维护纪律

- **版本冻结**：Bun 对 npm alias 的 peer 判定看**落盘包的 version**，故 `koishi-shim` 冻结 4.18.x 线（`@koishijs/core` 一行的 alias 必须与 `@koishi-ce/loader` 的 peer 声明逐字相等——那是精确版本、不带 `^`，具体数值以该 peer 声明为准）、`console-shim` 冻结 5.30.x 线。**勿改为本仓 1.x 基线、勿随 changesets bump**，要动只跟随上游对应版本线；本文档与各包 README 示例中的具体版本号随冻结线同步更新。
- **不写 changeset**：两包均已在 `.changeset/config.json` 的 `ignore` 列表。
- **发布顺序**：`console-shim` 发布须先于 `create-koishi-ce`（模板依赖它）。
- **发布走 `bun run release` 发布链**，禁止手动 `npm publish`。
