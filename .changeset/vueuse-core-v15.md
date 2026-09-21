---
"@koishi-ce/client": patch
"@koishi-ce/plugin-admin": patch
"@koishi-ce/plugin-explorer": patch
"@koishi-ce/plugin-insight": patch
"@koishi-ce/plugin-market": patch
---

依赖跟进：`@vueuse/core` 由 ^14.4.0 升到 ^15.0.0（全仓 5 处声明：`client` 为 dependencies，admin / explorer / insight / market 四插件为 devDependencies），非冻结线 major 清零。

破例点与本仓无实质交集：用到的 13 个符号（`useWindowSize` / `useEventListener` / `usePreferredDark` / `useResizeObserver` / `useLocalStorage` / `RemovableRef` / `useDebounceFn` / `watchDebounced` / `watchThrottled` / `useTimeoutFn` / `onKeyStroke` / `useElementSize` / `useThrottleFn`）在 15 全部保留；唯一有交集的是 `useThrottleFn` 的 `trailing` 默认值由 false 翻转为 true，而 `insight` 的 `watchThrottled` 已显式传 `trailing: true`，行为等价；被移除的 deprecated timer options（`interval` / `immediate` / `updateInterval` / `immediateCallback`）只落在本仓未使用的 composable 上。入口仍是 `dist/index.js`，宿主共享块 `vueuse.js` 的打包路径与 peer（`vue ^3.5.0`）均不变。
