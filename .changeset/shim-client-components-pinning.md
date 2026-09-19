---
"create-koishi-ce": minor
---

模板新增 `@koishijs/client` / `@koishijs/components` 两行上游名钉名（指向新 shim 包 `@koishi-ce/client-shim` / `@koishi-ce/components-shim`）。

第三方 webui 插件常把这两个名字写进 **dependencies**（非 peer）——2026-09-19 经 koishi-plugin-adapter-napuketto 实证：市场安装后 npm 官方 client 5.30.11 与 components 1.5.22 落盘根 node_modules，与 CE 前端库形成双实例。钉名后 Bun 的满足性判定（看落盘版本）将其解析到 CE 对应包，官方全家桶不再落盘。

新 shim 包首版须随本次发布一起上 npm（发布顺序：shim 先于 create-koishi-ce）。
