---
"@koishi-ce/core": patch
"@koishi-ce/console": minor
"@koishi-ce/client": minor
"@koishi-ce/loader": minor
"@koishi-ce/utils": minor
"@koishi-ce/plugin-dataview": patch
"@koishi-ce/plugin-explorer": patch
"@koishi-ce/plugin-insight": patch
"@koishi-ce/plugin-logger": patch
"@koishi-ce/plugin-sandbox": patch
"@koishi-ce/plugin-admin": patch
"@koishi-ce/plugin-commands": patch
"@koishi-ce/plugin-locales": patch
"@koishi-ce/plugin-notifier": patch
"@koishi-ce/plugin-theme-vanilla": patch
"@koishi-ce/plugin-welcome": patch
"@koishi-ce/plugin-config": patch
"@koishi-ce/plugin-market": patch
"@koishi-ce/plugin-console": patch
"create-koishi-ce": patch
---

fallow 审计收敛：断掉 core 最后一处循环依赖并收敛重复代码样板（1024 → 357 行）。

- core：runtime.ts 的 `Service.setup` 经新增的 context 工厂槽（`context/factory.ts`）创建 root Context，消除 context/index.ts ↔ runtime.ts 模块环，公共 API 不变。
- console（核心包）：新增 `clientEntry` 导出——插件向控制台注册前端产物的三环境路径样板（KOISHI_BASE 部署 / browser 构建 / 本地 dev-prod），各 webui 插件入口的三分支复制统一改为一行调用。
- client：新增 `extendLocales`（插件前端入口的七语种词典批量注入，配合 `import.meta.glob` 收敛 import+extend 样板）与 `scrollActiveTree`（keep-alive 页面重激活时把 el-tree 激活节点滚到可视中央）。
- loader：公共导出 `insertKey` / `rename`（键顺序保持式改名工具），config 插件 writer 复用之。
- utils：新增 npm-registry 模块（`getLocalRegistry` / `readNpmrcRegistry` / `NPM_OFFICIAL_REGISTRY`），create-koishi-ce 与 market 的本机 registry 探测共享同一实现。
- config：manager/* 事件签名收敛到 `src/shared/console-events.ts` 唯一定义（node 与浏览器两端声明合并经 extends 引用）；global/group 设置面板的 modelValue 代理改用 `defineModel`。
- admin/sandbox/sqlite/check-docs-links：对称逻辑（用户组加入与移出、方向键历史回溯、`_all`/`_get` 读取原语、链接检查循环）就近抽取共享实现。
