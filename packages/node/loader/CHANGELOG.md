# @koishi-ce/loader

## 1.0.2

### Patch Changes

- bcfbe4e: 修复 Bun 运行时下市场安装上游插件的两大报错：postgres 等「exports 带 `bun` 条件指向 ESM」的包被上游 CJS 驱动链 require 到 ESM namespace，esbuild 的 `__toESM(mod, 1)` interop 无条件把整个 namespace 当 default，`@minatojs/driver-postgres` 据此抛 "is not a function ... is an instance of Module"——loader 现于加载插件前遍历其依赖树，对「Bun require 实际命中入口 ≠ Node require 语义入口」的包把后者预置进 `require.cache`（无分歧零副作用，ESM import 侧不受影响）；market 安装器装完插件报 `ResolveMessage: Cannot find module`（Bun 负缓存污染裸名）的旧版本驻留判定改走 resolvePackageJson + require.cache 目录前缀扫描。

## 1.0.1

### Patch Changes

- c9f7ef5: worker 启动流程新增端口预检：应用创建前探测 server 插件声明的端口区间（按包名识别，覆盖 vendored 包与上下游命名），全部被占时只输出一行提示并以退出码 1 干净退出——此前绑定失败会以 cordis 错误事件触发依赖 server 服务的全部插件连锁 dispose，刷出大片堆栈噪音。loader 顺势导出 `resolvePlugin` / `pluginCandidates` 供 worker 复用插件解析。
