# @koishi-ce/koishi-shim

**简体中文** | [English](#english)

上游包名 `koishi` / `@koishijs/core` / `@koishijs/loader` 三名共用的下游兼容 shim，是 [Koishi-CE](https://github.com/Koishi-CE/koishi) 仓库的原创作品。它本身不实现任何功能，只把上述三个名字的模块解析再导出到 [`@koishi-ce/koishi`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/cli)（core + loader 的合并再分发），使社区插件生态对上游名的 peer 依赖在 CE 项目中指向同一份框架实例，避免包管理器自动装下 npm 官方包形成双实例。

## 用法（下游项目）

在 `package.json` 中以 npm alias 钉名（`create-koishi-ce` 脚手架生成的模板已预置，请勿删除或改写）：

```jsonc
{
  "dependencies": {
    "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11",
    "@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11",
    "@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"
  }
}
```

注意 `@koishijs/core` 一行是精确版本（不带 `^`）——`@koishi-ce/loader` 的 peer 是精确版本 `4.18.11`，必须逐字相等。

## 维护纪律

- 版本冻结在 4.18.x 线：Bun 对 npm alias 的 peer 判定看落盘包的 version，故不随本仓 1.x 基线 bump；
- 已知缺口（刻意接受）：`import NodeLoader from "@koishijs/loader"` 形态的 default 导出经本 shim 不可达（ESM `export *` 不传播 default）；上游插件生态无此用法；
- 背景与完整说明见 [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)，本仓库原创作品，版权归 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A downstream compatibility shim shared by the three upstream names `koishi` / `@koishijs/core` / `@koishijs/loader`, original work of the [Koishi-CE](https://github.com/Koishi-CE/koishi) repository. It implements nothing itself — it re-exports all three names to [`@koishi-ce/koishi`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/cli) (the merged core + loader redistribution), so that peer dependencies on upstream names resolve to the single framework instance inside CE projects, instead of letting the package manager install the official npm packages as a duplicate.

## Usage (downstream projects)

Pin the names via npm aliases in `package.json` (preconfigured by the `create-koishi-ce` scaffold — do not remove or rewrite them):

```jsonc
{
  "dependencies": {
    "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11",
    "@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11",
    "@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"
  }
}
```

The `@koishijs/core` line is an exact version (no `^`) — the peer of `@koishi-ce/loader` is the exact `4.18.11` and must match verbatim.

## Maintenance notes

- The version is frozen on the 4.18.x line: Bun evaluates npm-alias peers against the on-disk version, so it never bumps with the repo's 1.x baseline.
- Known gap (accepted): the default export of `@koishijs/loader` is unreachable through this shim (ESM `export *` does not propagate default); nothing in the plugin ecosystem uses it.
- See [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md) for the full background.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE), original work of this repository, copyright Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
