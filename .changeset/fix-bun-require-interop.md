---
"@koishi-ce/loader": patch
"@koishi-ce/plugin-market": patch
---

修复 Bun 运行时下市场安装上游插件的两大报错：postgres 等「exports 带 `bun` 条件指向 ESM」的包被上游 CJS 驱动链 require 到 ESM namespace，esbuild 的 `__toESM(mod, 1)` interop 无条件把整个 namespace 当 default，`@minatojs/driver-postgres` 据此抛 "is not a function ... is an instance of Module"——loader 现于加载插件前遍历其依赖树，对「Bun require 实际命中入口 ≠ Node require 语义入口」的包把后者预置进 `require.cache`（无分歧零副作用，ESM import 侧不受影响）；market 安装器装完插件报 `ResolveMessage: Cannot find module`（Bun 负缓存污染裸名）的旧版本驻留判定改走 resolvePackageJson + require.cache 目录前缀扫描。
