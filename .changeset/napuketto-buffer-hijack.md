---
"@koishi-ce/loader": patch
"@koishi-ce/plugin-config": patch
---

修复安装含内置模块同名 polyfill 依赖的插件（如 adapter-napuketto 经 readable-stream 引入 buffer/events/process）后插件加载即崩、控制台日志刷屏的问题：

- loader：seedCjsInterop 对 `require.resolve` 返回裸名（内置模块解析结果）的依赖不再预置种子——此前 feross/buffer polyfill 被种进 `require.cache["buffer"]` 裸名键，全进程劫持内置 buffer 导出，pino → thread-stream 顶层取 `buffer.constants.MAX_STRING_LENGTH` 即抛 TypeError；
- config：`config/request-runtime` 解析失败同样写入缓存（failed 标记随数据下发，前端据此展示失败提示并停止重发），同键并发解析合并为一次模块加载——此前「前端请求 → 解析失败不缓存 → 广播 → 前端再请求」互相喂养成活锁，加载即崩的插件会瞬间打爆日志。
