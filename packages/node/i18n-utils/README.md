# @koishi-ce/i18n-utils

**简体中文** | [English](#english)

Koishi 的国际化辅助库，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `packages/i18n-utils`。它解决两个问题：把一组语言环境名构建为嵌套树，以及依据用户偏好计算回退查找顺序——核心包 `I18n` 服务的回退机制即建立在其上。

## 主要导出

- `LocaleTree`：`LocaleTree.from(locales)` 把 `zh-CN` / `zh-TW` / `en-US` 等语言环境名按 `-` 逐级展开为嵌套树；实现使用 null 原型对象防止原型污染。
- `fallback(tree, locales)`：依据用户偏好语言列表计算回退查找顺序——精确环境优先，依次退到各级父语言、根，再到其余可用语言；多个偏好按序处理并上移命中节点以保证优先级。

函数签名与 `@intlify/core-base` 保持兼容（Vue I18n 的底层库），便于类型互认。

## 用法

```ts
import { LocaleTree, fallback } from "@koishi-ce/i18n-utils";

const tree = LocaleTree.from(["zh-CN", "zh-TW", "en-US"]);
fallback(tree, ["zh-TW", "en-US"]); // => ["zh-TW", "zh", "en-US", "en"]
```

普通用户无需安装本包，它由 `@koishi-ce/core` 引入。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

I18n utilities for Koishi, ported from `packages/i18n-utils` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi). It does two things: builds a nested tree from a set of locale names, and computes fallback lookup orders from user preferences — the foundation of the `I18n` service in `@koishi-ce/core`.

## Key exports

- `LocaleTree` — `LocaleTree.from(locales)` expands locale names such as `zh-CN` / `zh-TW` / `en-US` into a nested tree by splitting on `-`, using null-prototype objects to guard against prototype pollution.
- `fallback(tree, locales)` — computes the fallback lookup order for a list of preferred locales: exact locale first, then each parent language up to the root, then remaining available languages.

The function signatures intentionally stay compatible with `@intlify/core-base` (the core of Vue I18n).

## Usage

```ts
import { LocaleTree, fallback } from "@koishi-ce/i18n-utils";

const tree = LocaleTree.from(["zh-CN", "zh-TW", "en-US"]);
fallback(tree, ["zh-TW", "en-US"]); // => ["zh-TW", "zh", "en-US", "en"]
```

End users never install this package directly; it is a dependency of `@koishi-ce/core`.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
