# @koishi-ce/utils

**简体中文** | [English](#english)

Koishi 的通用工具函数集合，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `packages/utils`。不依赖 Koishi 运行时，任何 Node 侧包都可以安全引用；核心包将其全量再导出，插件作者通常经 `@koishi-ce/core` 间接获得这些工具。

## 主要导出

再导出 cosmokit 全部工具、`is` 类型守卫（别名 `isType`）与 [inaba](https://github.com/shigma/inaba) 随机数库的 `Random`，另含三个自有模块：

- `misc.ts`：`sleep`、`enumKeys`、`merge`、`coerce`（字符串到原始类型的强转）、`extend`（原型方法混入）、`defineEnumProperty` 等杂项工具；
- `observe.ts`：`observe()` 与 `Observed<T>`——基于 Proxy 的深度变更追踪：对普通对象取观察者，变更记录在 `$diff`，`$update()` 取出差量交回调消费。minato ORM「取出实体、修改、落盘差量」的更新机制即由此实现；
- `string.ts`：`interpolate`——Koishi 配置中 `${{ expr }}` 与 `{{ expr }}` 表达式插值的底层实现；`escapeRegExp`。

## 用法

```ts
import { observe, sleep, interpolate } from "@koishi-ce/utils";

const user = observe({ name: "Koishi" }, () => console.log("changed"));
user.name = "CE";
user.$update();
```

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

A collection of general-purpose utilities for Koishi, ported from `packages/utils` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi). It has no dependency on the Koishi runtime and can be imported safely by any Node-side package; `@koishi-ce/core` re-exports all of it, so plugin authors usually get these tools transitively.

## Key exports

Re-exports all of cosmokit, the `is` type guards (aliased `isType`) and the `Random` library, plus three home-grown modules:

- `misc.ts` — `sleep`, `enumKeys`, `merge`, `coerce` (string-to-primitive casting), `extend` (prototype mixin), `defineEnumProperty` and more.
- `observe.ts` — `observe()` / `Observed<T>`: Proxy-based deep change tracking. Changes are recorded into `$diff`; `$update()` consumes the diff through a callback. This is the mechanism behind minato's "fetch entity, mutate, persist the diff" updates.
- `string.ts` — `interpolate`, the engine behind the `${{ expr }}` / `{{ expr }}` interpolation in Koishi configs; plus `escapeRegExp`.

## Usage

```ts
import { observe, sleep, interpolate } from "@koishi-ce/utils";

const user = observe({ name: "Koishi" }, () => console.log("changed"));
user.name = "CE";
user.$update();
```

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
