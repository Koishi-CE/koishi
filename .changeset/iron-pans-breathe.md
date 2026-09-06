---
"@koishi-ce/loader": patch
"@koishi-ce/client": patch
---

修复下游 Bun 环境启动段错误与 devMode vite 无法启动

- loader：CJS interop 种子预置不再 require 非 CJS 入口（.mjs / type:module 的 .js 等），并跳过 realpath 同一实体文件的伪分歧路径——此前会对依赖树里的包无差别执行入口顶层副作用，unocss 66.10 拖入的 zigpty（入口顶层 dlopen，Bun win32 直接段错误且不可捕获）即被引爆，下游 `bun dev` 在 console 插件后必崩
- client：collectWorkspaceAliases 在下游 npm 安装布局（.bun 嵌套 / 根提升）下上跳四级读不到仓库根清单时返回空表而非抛 ENOENT——该函数在模块顶层 await 执行，抛出会拖垮整个 client 加载，devMode 的 vite dev server 随之无法启动
