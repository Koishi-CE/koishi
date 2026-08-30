---
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-config": patch
---

修正前端入口注册的 `__dirname` 相对路径：本文件位于 `src/node`（两层），打包后位于 `lib`（一层），按源码深度写的 `../../dist` / `../../client` 在产物中解析到错误目录，导致生产模式下插件前端资源 404。
