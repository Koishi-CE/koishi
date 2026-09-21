---
"@koishi-ce/plugin-explorer": patch
---

依赖收敛：文件树路径过滤由 `anymatch` 换为直连 `picomatch` 4（该版本本仓已由 vite / tsdown 等经传递依赖引入，显式声明不新增物理包），`anymatch` / `normalize-path` 及其嵌套的 `picomatch@2` 三包出仓，物理依赖净减 2；源码中为 anymatch 的 CJS/ESM 互操作保留的 `as unknown as` 双重断言随之清零（断言基线 18 → 17）。行为经多模式 × 13 输入矩阵实测与原先逐条一致（含 win32 反斜杠路径与 dotfile 忽略），另显式声明 `windows` 平台选项以规避 picomatch 4「不传 options 即按 posix 处理」的坑点。
