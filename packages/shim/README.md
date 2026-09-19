# packages/shim

本目录集中存放**上游包名占位 shim**（纯 JS 预编译包，无 `src/`、不走根 tsdown 构建、版本冻结、changesets ignore）。

这些包本身不实现任何功能，只做一件事：**以 npm alias 的形式占用上游包名，把依赖树中对上游名的解析指回本仓对应的 `@koishi-ce/*` 包**，从而阻止包管理器与市场运行时自动安装 npm 官方包，避免形成第二份框架 / console 副本。

## 为什么需要 shim

本仓框架包名是 `@koishi-ce/koishi`（core + loader 合并再分发），而社区插件生态（上游官方 adapter / database 插件与 `koishi-plugin-*`）的 `peerDependencies` 指向上游名（`koishi` / `@koishijs/core` / `@koishijs/loader` / `@koishijs/plugin-console`）；第三方 webui 插件还会把 `@koishijs/client` / `@koishijs/components` 写进 **dependencies**（2026-09-19 koishi-plugin-adapter-napuketto 实证：官方 client 落盘并连带官方 components 全家桶）。

下游项目如果不占住这些名字，任何一次 `bun add`（或市场运行时安装）都会因 peer 无归属或普通依赖边解析而让 Bun 装下 npm 官方全家桶，与 CE 框架形成双实例，破坏 cordis 对象身份与 `instanceof` 语义。

workspace 内部不需要这些 shim（本仓代码一律直接 `import ... from "@koishi-ce/*"`，root 也无需为上游名声明依赖）；shim 的服务对象是**下游项目**——由 `create-koishi-ce` 生成、以 Bun 为运行时的 CE 实例。

## 包列表

| 包名 | 版本 | 占用的上游名 | re-export 源 |
| --- | --- | --- | --- |
| `@koishi-ce/koishi-shim` | 4.18.x 冻结线 | `koishi` / `@koishijs/core` / `@koishijs/loader` | `@koishi-ce/koishi` |
| `@koishi-ce/console-shim` | 5.30.x 冻结线 | `@koishijs/plugin-console` | `@koishi-ce/plugin-console` |
| `@koishi-ce/client-shim` | 5.30.x 冻结线 | `@koishijs/client` | `@koishi-ce/client` |
| `@koishi-ce/components-shim` | 1.5.x 冻结线 | `@koishijs/components` | `@koishi-ce/components` |

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
    "@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11",
    "@koishijs/client": "npm:@koishi-ce/client-shim@^5.30.11",
    "@koishijs/components": "npm:@koishi-ce/components-shim@^1.5.22"
  }
}
```

社区插件的 peer（`koishi ^4.x`、`@koishijs/plugin-console ^5.30.x` 等）与 webui 插件写进 dependencies 的 `@koishijs/client ^5.x` / `@koishijs/components ^1.5.x` 经此全部钉回 CE 对应包，不会形成第二份框架 / console / 前端库副本。注意钉名对普通依赖边同样生效的前提是**落盘版本满足声明范围**——这正是各 shim 冻结在上游版本线的原因。

### 三层防线

`create-koishi-ce` 模板（1.8.0 起）与 sandbox 生成器为下游实例预置了完整的防污染体系：

1. **六行钉名**（dependencies 占位）：常规满足层，peer 与 dependencies 声明靠落盘版本复用槽位；market 安装器的 `isGuardedRequest()` 同步护栏防改写；
2. **overrides 强制重写**（`overrides` 块，41 个上游名 → CE 对应包）：兜底层，**不看版本满足性**把整棵依赖树中对这些上游名的解析一律改指 CE 包——第三方插件声明钉名清单外的上游名（如 `@koishijs/plugin-admin`、`@koishijs/utils`）或超出冻结线的范围（如未来上游升线后的 `^6`）时由本层兜住；清单 = CE 已再分发且官方同名的包（CE 原创包与上游裸名社区对应物不在列，不拦官方生态的真实依赖）；
3. **market 护栏**：`isGuardedRequest()` 把 `npm:@koishi-ce` 前缀与 `workspace:` 声明同等保护，市场安装不改写钉名行。

## 维护纪律

- **版本冻结**：Bun 对 npm alias 的满足性判定看**落盘包的 version**，故 `koishi-shim` 冻结 4.18.x 线（`@koishijs/core` 一行的 alias 必须与 `@koishi-ce/loader` 的 peer 声明逐字相等——那是精确版本、不带 `^`，具体数值以该 peer 声明为准）、`console-shim` / `client-shim` 冻结 5.30.x 线（跟随上游 console / client 版本线）、`components-shim` 冻结 1.5.x 线。**勿改为本仓 1.x 基线、勿随 changesets bump**，要动只跟随上游对应版本线；本文档与各包 README 示例中的具体版本号随冻结线同步更新。
- **不写 changeset**：四包均已在 `.changeset/config.json` 的 `ignore` 列表。
- **发布顺序**：shim 包发布须先于 `create-koishi-ce`（模板依赖它们）。
- **发布走 `bun run release` 发布链**，禁止手动 `npm publish`。
