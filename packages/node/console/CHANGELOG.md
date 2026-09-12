# @koishi-ce/console

## 1.1.0

### Minor Changes

- e537fa2: fallow 审计收敛：断掉 core 最后一处循环依赖并收敛重复代码样板（1024 → 357 行）。
  
  - core：runtime.ts 的 `Service.setup` 经新增的 context 工厂槽（`context/factory.ts`）创建 root Context，消除 context/index.ts ↔ runtime.ts 模块环，公共 API 不变。
  - console（核心包）：新增 `clientEntry` 导出——插件向控制台注册前端产物的三环境路径样板（KOISHI_BASE 部署 / browser 构建 / 本地 dev-prod），各 webui 插件入口的三分支复制统一改为一行调用。
  - client：新增 `extendLocales`（插件前端入口的七语种词典批量注入，配合 `import.meta.glob` 收敛 import+extend 样板）与 `scrollActiveTree`（keep-alive 页面重激活时把 el-tree 激活节点滚到可视中央）。
  - loader：公共导出 `insertKey` / `rename`（键顺序保持式改名工具），config 插件 writer 复用之。
  - utils：新增 npm-registry 模块（`getLocalRegistry` / `readNpmrcRegistry` / `NPM_OFFICIAL_REGISTRY`），create-koishi-ce 与 market 的本机 registry 探测共享同一实现。
  - config：manager/* 事件签名收敛到 `src/shared/console-events.ts` 唯一定义（node 与浏览器两端声明合并经 extends 引用）；global/group 设置面板的 modelValue 代理改用 `defineModel`。
  - admin/sandbox/sqlite/check-docs-links：对称逻辑（用户组加入与移出、方向键历史回溯、`_all`/`_get` 读取原语、链接检查循环）就近抽取共享实现。

### Patch Changes

- @koishi-ce/koishi@1.0.16

## 1.0.1

### Patch Changes

- 412c225: Bun 原生化收尾清扫：console 入口/实例随机标识、core shortcut 随机 i18n 键改 crypto.randomUUID（仅唯一性用途，无格式契约）；loader 迁移缺省标识从 6 字符 base36 改 UUID（消灭截断碰撞面，写入用户配置的 `group/<前缀>:<标识>` 键变长，唯一性彻底）；hmr 两处 require.resolve 解析锚点换 Bun.resolveSync（createRequire 本体因需 require 文件保留）。
- @koishi-ce/koishi@1.0.15
