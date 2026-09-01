# @koishi-ce/console-shim

**简体中文** | [English](#english)

上游包名 `@koishijs/plugin-console` 的下游兼容 shim，是 [Koishi-CE](https://github.com/Koishi-CE/koishi) 仓库的原创作品。它本身不实现任何功能，只把该名字的模块解析再导出到 [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console)，使社区生态与 CE 插件对上游 console 的 peer 依赖（`^5.30`）指向 CE 版控制台，避免 Bun 的 peer 自动安装拉下 npm 官方 console 形成双实例。

## 用法（下游项目）

在 `package.json` 中以 npm alias 钉名（`create-koishi-ce` 脚手架生成的模板已预置，请勿删除或改写）：

```jsonc
{
  "dependencies": {
    "@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"
  }
}
```

## 维护纪律

- 版本冻结在 5.30.x 线以满足 `^5.30` peer，不随本仓 1.x 基线 bump；
- 发布顺序须先于 `create-koishi-ce`（脚手架模板依赖它）；
- 背景与完整说明见 [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)，本仓库原创作品，版权归 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A downstream compatibility shim for the upstream name `@koishijs/plugin-console`, original work of the [Koishi-CE](https://github.com/Koishi-CE/koishi) repository. It implements nothing itself — it re-exports that name to [`@koishi-ce/plugin-console`](https://github.com/Koishi-CE/koishi/tree/main/plugins/webui/console), so peer dependencies on the upstream console (`^5.30`) resolve to the CE console instead of Bun auto-installing the official npm package as a duplicate.

## Usage (downstream projects)

Pin the name via an npm alias in `package.json` (preconfigured by the `create-koishi-ce` scaffold — do not remove or rewrite it):

```jsonc
{
  "dependencies": {
    "@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"
  }
}
```

## Maintenance notes

- The version is frozen on the 5.30.x line to satisfy `^5.30` peers; it never bumps with the repo's 1.x baseline.
- It must be published before `create-koishi-ce` (the scaffold template depends on it).
- See [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md) for the full background.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE), original work of this repository, copyright Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
