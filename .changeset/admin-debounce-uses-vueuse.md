---
"@koishi-ce/plugin-admin": patch
---

依赖借力消减：admin 前端行内重命名的防抖由 `throttle-debounce` 换为前端栈既有的 `@vueuse/core`（`useDebounceFn`），外部依赖净减 1 包；配套移除该库的本地类型垫片，`@vueuse/core` 改为 devDependencies 声明（构建期由宿主解析）。
