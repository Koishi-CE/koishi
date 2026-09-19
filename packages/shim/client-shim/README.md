# @koishi-ce/client-shim

**简体中文** | [English](#english)

上游包名 `@koishijs/client` 的下游兼容 shim，是 [Koishi-CE](https://github.com/Koishi-CE/koishi) 仓库的原创作品。它本身不实现任何功能，只把该名字的模块解析再导出到 [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client)，使第三方 webui 插件对上游 client 的声明（`^5.x`）指向 CE 版前端库，避免 Bun 的自动安装拉下 npm 官方 client（连带官方 components 全家桶）形成双实例。

与 peer 型的 console-shim 不同，本名的主要威胁形态是第三方插件把 `@koishijs/client` 直接写进 **dependencies**（如 koishi-plugin-adapter-napuketto）——peer 钉名拦不住普通依赖边，只有名字槽位落盘版本满足声明才行。

## 用法（下游项目）

在 `package.json` 中以 npm alias 钉名（`create-koishi-ce` 脚手架生成的模板已预置，请勿删除或改写）：

```jsonc
{
  "dependencies": {
    "@koishijs/client": "npm:@koishi-ce/client-shim@^5.30.11"
  }
}
```

## 维护纪律

- 版本冻结在 5.30.x 线以满足 `^5.x` 声明，不随本仓 1.x 基线 bump；
- 发布顺序须先于 `create-koishi-ce`（脚手架模板依赖它）；
- 背景与完整说明见 [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)，本仓库原创作品，版权归 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A downstream compatibility shim for the upstream name `@koishijs/client`, original work of the [Koishi-CE](https://github.com/Koishi-CE/koishi) repository. It implements nothing itself — it re-exports that name to [`@koishi-ce/client`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/client), so third-party webui plugins declaring the upstream client (`^5.x`) resolve to the CE client instead of Bun auto-installing the official npm package (which drags in the official components entourage) as a duplicate.

Unlike the peer-oriented console-shim, the main threat here is third-party plugins declaring `@koishijs/client` directly in **dependencies** (e.g. koishi-plugin-adapter-napuketto) — peer pinning does not stop regular dependency edges; only an occupied name slot whose on-disk version satisfies the range does.

## Usage (downstream projects)

Pin the name via an npm alias in `package.json` (preconfigured by the `create-koishi-ce` scaffold — do not remove or rewrite it):

```jsonc
{
  "dependencies": {
    "@koishijs/client": "npm:@koishi-ce/client-shim@^5.30.11"
  }
}
```

## Maintenance notes

- The version is frozen on the 5.30.x line to satisfy `^5.x` declarations; it never bumps with the repo's 1.x baseline.
- It must be published before `create-koishi-ce` (the scaffold template depends on it).
- See [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md) for the full background.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE), original work of this repository, copyright Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
