# @koishi-ce/utils

## 1.1.1

### Patch Changes

- 13b6aff: `coerce` 在消息含换行时不再把错误文本退化成一行裸栈帧：
  
  - 背景（实测于 CI 偶发红）：`coerce` 用 `findIndex(line => line.endsWith(message))` 定位消息行，**消息含换行时没有任何一行以整条消息结尾**，`findIndex` 返回 `-1`，而 `lines.slice(-1)` 恰好只留下最外层栈帧——调用方（控制台前端、命令与中间件的错误渲染）拿到的「错误消息」就变成一行 `    at ...`，消息本体完全丢失。触发形态：把一次 `coerce` 的文本再包成 `Error`（`new Error(coerced)`），或任何自带多行 message 的异常；
  - 修法：快路径不变（整条消息结尾定位，保留原有「丢弃无关外层帧」语义）；定位失败时回退为「消息首行结尾定位」（堆栈首行恒为 `Error: <消息首行>`）；仍定位不到（如堆栈被替换）则把消息补回栈首，保证消息本体不丢；
  - 用例：`packages/node/utils` 新增两条单测（多行消息、栈中无消息的兜底），`packages/node/console` RPC 层新增一条端到端回归（多行消息异常仍回传消息本体）。

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
