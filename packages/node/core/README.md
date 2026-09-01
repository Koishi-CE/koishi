# @koishi-ce/core

**简体中文** | [English](#english)

Koishi 框架的核心包，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `packages/core`。一个 `Context` 实例就是一个完整的机器人应用：指令系统、会话、消息中间件、国际化、权限、过滤器与数据库在核心内开箱即用。

普通用户通常不需要直接安装本包——终端入口是 [`@koishi-ce/koishi`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/cli)（core 与 loader 的合并主包）；本包面向需要编程式启动或深度定制宿主的场景。

## 主要能力

- **Context 与应用组装**：构造时提供九个核心服务（`$filter` / `schema` / `$processor` / `i18n` / `permissions` / `model` / `http` / `$commander` 等），并通过 `ctx.mixin` 暴露 `ctx.command` / `ctx.middleware` / `ctx.match` / `ctx.filter` 等快捷 API。`App` 是 `Context` 的历史别名。`defineConfig` 提供根配置的类型推导。
- **指令系统**：三层结构——词法与参数解析（parser）、面向用户的 `Command` 类（execute 洋葱管线、级联 dispose、斜线指令同步）与 `Commander` 注册表。内置 `<foo:number>` 等参数类型（domain 体系，可扩展），支持参数与选项校验、指令声明串解析。
- **会话**：`Session` 由六层继承链组装（core → messaging → observe → locale → execute → interact），mixin 出 `session.send` / `prompt` / `execute` / `suggest` 等方法。
- **消息处理**：`$processor` 洋葱队列处理消息事件；`ctx.match` 提供快捷对话；频道与用户数据在中间件层自动装配；内置一组消息组件。
- **国际化**：`I18n` 服务支持 define / render 与基于 Levenshtein 距离的纠错建议，随包附带七种内置语言（zh-CN / zh-TW / en-US / ja-JP / de-DE / fr-FR / ru-RU），回退序列由 [`@koishi-ce/i18n-utils`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/i18n-utils) 计算。
- **数据库**：全量再导出 [minato](https://github.com/minatojs/minato) ORM，并在其上封装 `user` / `binding` / `channel` 三张核心表与全服广播方法。
- **过滤器与权限**：`FilterService` 提供过滤器组合代数与 `Computed<T>` 计算属性；`Permissions` 服务内置 `authority:N` 权限模板，支持 depends 与 inherits。
- **Schema 扩展**：在 cordis 的 Schema 之上补充 `Schema.computed` / `filter` / `path` / `dynamic` 构造器。

## 导出一览

`src/index.ts` 统一再导出：

- [`@koishi-ce/utils`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/utils) 的全部工具函数与 minato ORM 的全部导出；
- `Context` / `App` / `Session` / `Command` / `Commander` / `I18n` / `KoishiDatabase` / `FilterService` / `Permissions` 等核心类；
- Koishi 生态的 `Service` 基类、`defineConfig` 与 `version` 常量。

## 用法

编程式启动：

```ts
import { App, defineConfig } from "@koishi-ce/core";

const app = new App(defineConfig({
  plugins: {
    "console": {},
  },
}));

await app.start();
```

绝大多数场景建议直接使用 `@koishi-ce/koishi` 的 `koishi start` 命令，由 loader 按配置文件组装应用。

## 与上游的差异

- 内置一处补丁：对 `satori.Bot.prototype.dispose` 加防护，规避 satori 4.6.0 在 `app.stop()` 时抛出 TypeError 的缺陷（升级 satori 修复后可移除）。
- 包内导入一律指向 `@koishi-ce/*` workspace 包；其余行为与上游保持一致，目录级映射见仓库 [docs/UPSTREAM.md](https://github.com/Koishi-CE/koishi/blob/main/docs/UPSTREAM.md)。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The core package of the Koishi framework, ported from `packages/core` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi). A single `Context` instance is a complete bot application: commands, sessions, message middleware, i18n, permissions, filters and database access all come built in.

End users normally install [`@koishi-ce/koishi`](https://github.com/Koishi-CE/koishi/tree/main/packages/node/cli) (the merged core + loader host package) instead of this package; `@koishi-ce/core` is for programmatic bootstrapping and custom hosts.

## Highlights

- **Context and app assembly** — nine core services provided on construction, with `ctx.command` / `ctx.middleware` / `ctx.match` / `ctx.filter` mixins; `App` is a legacy alias of `Context`.
- **Command system** — a three-layer design (parser / `Command` / `Commander` registry) with extensible argument domains, validation and slash-command sync.
- **Sessions** — a six-layer `Session` chain mixin-ing `send` / `prompt` / `execute` / `suggest`.
- **Message processing** — the `$processor` onion queue, quick-dialogue `ctx.match`, automatic channel/user attachment and built-in message components.
- **I18n** — define/render APIs, Levenshtein-based suggestions, seven bundled locales.
- **Database** — full re-export of the minato ORM plus the built-in `user` / `binding` / `channel` tables and broadcast helpers.
- **Filters and permissions** — filter algebra with `Computed<T>` values and an `authority:N` permission template.
- **Schema extensions** — `Schema.computed` / `filter` / `path` / `dynamic` constructors.

## Usage

```ts
import { App, defineConfig } from "@koishi-ce/core";

const app = new App(defineConfig({ plugins: {} }));
await app.start();
```

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
