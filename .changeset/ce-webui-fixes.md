---
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-config": patch
---

fix(market,config): 修复安装弹窗版本键越界解构报错与上游名 peer「依赖未满足」误报

- market 安装弹窗的 result computed 在版本号来自 override 暂存或依赖 range（非精确版本号）时对 `data.value[version.value]` 直接解构，控制台抛 `Cannot destructure property 'result'`——改为可选链兜底，查不到按未定级处理；showRemoveButton 同步补 `store.dependencies?.` 可选链
- config 的 getEnvInfo 对 peer 上游名（如社区插件声明的 `@koishijs/plugin-console`）按字面名直查 store.packages，被 shim / npm alias 占名时必然查不到而误报「必需依赖 (点击添加)」——新增 resolveProvider 归一：字面名查不到时回退 `@koishi-ce/plugin-*` 再分发名，coreDeps 判定与已加载态均按归一结果；market 的 dep-link 同规则内联（避免跨插件值引入整份 config 前端），点击目标跟随归一名
