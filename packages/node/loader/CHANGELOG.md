# @koishi-ce/loader

## 1.0.1

### Patch Changes

- c9f7ef5: worker 启动流程新增端口预检：应用创建前探测 server 插件声明的端口区间（按包名识别，覆盖 vendored 包与上下游命名），全部被占时只输出一行提示并以退出码 1 干净退出——此前绑定失败会以 cordis 错误事件触发依赖 server 服务的全部插件连锁 dispose，刷出大片堆栈噪音。loader 顺势导出 `resolvePlugin` / `pluginCandidates` 供 worker 复用插件解析。
