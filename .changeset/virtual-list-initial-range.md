---
"@koishi-ce/components": patch
---

修复虚拟列表首屏渲染区间为空的缺陷：本仓因严格 TS 把 `Virtual.range` 初始零值写死（上游为空对象、`start` 为 `undefined`），使构造函数 `checkRange(0, count)` 的 start 相等守卫（`0 !== 0` 恒假）跳过了首次 `updateRange`，`end` 停留在 0，首屏渲染区间为 `[0, 0)`。表现为日志页冷加载时历史日志全部不显示，直到第一条新日志（patch 使数组长度变化、触发无条件重算）才"唤醒"列表——日志安静的实例因此永久空白。现构造时绕过守卫直接写入初始区间 `[0, min(count, 总数))`，并补初始区间回归测试。
