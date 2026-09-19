# @koishi-ce/components-shim

**简体中文** | [English](#english)

上游包名 `@koishijs/components` 的下游兼容 shim，是 [Koishi-CE](https://github.com/Koishi-CE/koishi) 仓库的原创作品。它本身不实现任何功能，只把该名字的模块解析再导出到 [`@koishi-ce/components`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/components)，使第三方 webui 插件对上游组件库的声明（`^1.5`）指向 CE 版组件库，避免 Bun 的自动安装拉下 npm 官方组件库形成双实例（schema 表单、虚拟列表等组件注册两份，行为不可预期）。

## 用法（下游项目）

在 `package.json` 中以 npm alias 钉名（`create-koishi-ce` 脚手架生成的模板已预置，请勿删除或改写）：

```jsonc
{
  "dependencies": {
    "@koishijs/components": "npm:@koishi-ce/components-shim@^1.5.22"
  }
}
```

## 维护纪律

- 版本冻结在 1.5.x 线以满足 `^1.5` 声明，不随本仓 1.x 基线 bump；
- 发布顺序须先于 `create-koishi-ce`（脚手架模板依赖它）；
- 背景与完整说明见 [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)，本仓库原创作品，版权归 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A downstream compatibility shim for the upstream name `@koishijs/components`, original work of the [Koishi-CE](https://github.com/Koishi-CE/koishi) repository. It implements nothing itself — it re-exports that name to [`@koishi-ce/components`](https://github.com/Koishi-CE/koishi/tree/main/packages/web/components), so third-party webui plugins declaring the upstream component library (`^1.5`) resolve to the CE one instead of Bun auto-installing the official npm package as a duplicate (two registered copies of schema forms / virtual lists and friends behave unpredictably).

## Usage (downstream projects)

Pin the name via an npm alias in `package.json` (preconfigured by the `create-koishi-ce` scaffold — do not remove or rewrite it):

```jsonc
{
  "dependencies": {
    "@koishijs/components": "npm:@koishi-ce/components-shim@^1.5.22"
  }
}
```

## Maintenance notes

- The version is frozen on the 1.5.x line to satisfy `^1.5` declarations; it never bumps with the repo's 1.x baseline.
- It must be published before `create-koishi-ce` (the scaffold template depends on it).
- See [packages/shim/README.md](https://github.com/Koishi-CE/koishi/blob/main/packages/shim/README.md) for the full background.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE), original work of this repository, copyright Koishi-CE contributors — see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE).
