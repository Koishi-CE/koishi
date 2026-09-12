# @koishi-ce/plugin-dataview

## 1.1.3

### Patch Changes

- e537fa2: fallow 审计收敛：断掉 core 最后一处循环依赖并收敛重复代码样板（1024 → 357 行）。
  
  - core：runtime.ts 的 `Service.setup` 经新增的 context 工厂槽（`context/factory.ts`）创建 root Context，消除 context/index.ts ↔ runtime.ts 模块环，公共 API 不变。
  - console（核心包）：新增 `clientEntry` 导出——插件向控制台注册前端产物的三环境路径样板（KOISHI_BASE 部署 / browser 构建 / 本地 dev-prod），各 webui 插件入口的三分支复制统一改为一行调用。
  - client：新增 `extendLocales`（插件前端入口的七语种词典批量注入，配合 `import.meta.glob` 收敛 import+extend 样板）与 `scrollActiveTree`（keep-alive 页面重激活时把 el-tree 激活节点滚到可视中央）。
  - loader：公共导出 `insertKey` / `rename`（键顺序保持式改名工具），config 插件 writer 复用之。
  - utils：新增 npm-registry 模块（`getLocalRegistry` / `readNpmrcRegistry` / `NPM_OFFICIAL_REGISTRY`），create-koishi-ce 与 market 的本机 registry 探测共享同一实现。
  - config：manager/* 事件签名收敛到 `src/shared/console-events.ts` 唯一定义（node 与浏览器两端声明合并经 extends 引用）；global/group 设置面板的 modelValue 代理改用 `defineModel`。
  - admin/sandbox/sqlite/check-docs-links：对称逻辑（用户组加入与移出、方向键历史回溯、`_all`/`_get` 读取原语、链接检查循环）就近抽取共享实现。
- Updated dependencies [e537fa2]
  - @koishi-ce/console@1.1.0
  - @koishi-ce/plugin-console@1.3.4
  - @koishi-ce/koishi@1.0.16

## 1.1.2

### Patch Changes

- Updated dependencies [412c225]
  - @koishi-ce/console@1.0.1
  - @koishi-ce/plugin-console@1.3.3
  - @koishi-ce/koishi@1.0.15

## 1.1.1

### Patch Changes

- 6b389b1: 修复 database/* 系列 RPC 因丢失方法宿主而全数报错、页面整表空白的问题。addListener 代理数据库方法时把方法引用取出裸调，minato 的方法内部依赖 this（get 首行即 this.select），detached 调用直接抛 TypeError，被前端 updateData 的静默 catch 吞成空表格；改为经宿主对象成员调用，与上游 @koishijs/plugin-dataview 2.3.1 的写法对齐。

## 1.1.0

### Minor Changes

- 98c86df: i18n: 五个 webui 插件前端文案接入全局词典
  
  - explorer / config / dataview / insight / analytics 的 client 侧新增 7 语种词典，经 `ctx.$i18n.extend()` 注入宿主全局实例，页名、菜单、按钮、确认框、toast 等文案随设置页语言切换实时生效
  - explorer 的 node 侧 schema 词典补齐 7 语种；analytics 的两处 schema 描述由中文直写改为 `.i18n()`
  - 宿主侧配套：`$i18n.t` 支持插值参数、`createChart` 的标题支持 getter（详见 @koishi-ce/client 的 changeset）

### Patch Changes

- ad309a8: 修正包元数据：plugin-http 与 plugin-proxy-agent 的 repository / bugs / homepage 原误指向上游 cordiverse/http 仓库，改指本仓对应目录；plugin-dataview 的 contributors 补齐双人署名；keywords 去重与补全。仅元数据字段，无代码行为变更。
- Updated dependencies [bac9f1d]
  - @koishi-ce/plugin-console@1.1.0
  - @koishi-ce/koishi@1.0.8

## 1.0.1

### Patch Changes

- d1329eb: feat(eco): 再分发五个上游官方插件，补齐官方实例默认插件版图
  
  - **@koishi-ce/plugin-theme-vanilla**（上游 koishijs/theme-vanilla，AGPL）：八套控制台主题（coffee / ocean / pale-night / solarized / winter 各系）
  - **@koishi-ce/plugin-server-temp**（上游 cordiverse/server @cordisjs/plugin-server-temp，MIT，src 化移植）：`server.temp` 服务——临时文件落盘、`/temp/:name` 路由与到期清理
  - **@koishi-ce/assets**（上游 @koishijs/assets 基类包，MIT）+ **@koishi-ce/plugin-assets-local**（上游 koishi-plugin-assets-local，MIT）：assets 资源服务抽象与本地目录实现（魔数判型、HMAC 上传校验、旧 public/ 目录迁移）；文件类型探测改用 file-type@22 的 fileTypeFromBuffer（与 explorer 同线，不引入 16.x 双版本），GET 路由以头部字节判定 MIME
  - **@koishi-ce/plugin-rate-limit**（上游 koishijs/common packages/rate-limit，MIT）：指令调用次数 / 频率限制，usage / timer 管理命令，上游测试全量移植为 bun:test
  - **@koishi-ce/plugin-dataview**（上游 koishijs/koishi-plugin-dataview，AGPL）：控制台数据库查看与管理（minato 深层 API、client 类型镜像走 market 范式）
  - analytics 的未使用依赖 `@koishijs/assets` 换为 `@koishi-ce/assets`
  - 上游 telemetry 评估后放弃移植：未发布半成品、无 LICENSE 正文、硬编码第三方遥测后端且采集机器指纹
