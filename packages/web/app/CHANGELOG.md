# @koishi-ce/console-app

## 1.0.5

### Patch Changes

- 28e0a85: 补全局组件与指令的类型声明（GlobalComponents / GlobalDirectives）：k-* 组件族、virtual-list 与 v-loading 此前无类型（vue-tsc 宽松放过），现经 vue 模块增强合并获得真实类型；随之修复暴露的模板类型错误（undefined 兜底、slot prop 收窄、k-tab 的 data 契约放宽数组形态），并断开 computed.vue 对 schemastery-vue 裸名的源码导入链（消除类型程序里的第三方源码噪音）。
- Updated dependencies [28e0a85]
  - @koishi-ce/components@1.1.2
  - @koishi-ce/client@1.4.4

## 1.0.4

### Patch Changes

- e9258a1: 验证 npm OIDC 信任配置：本批 27 个包的 latest 仍是 OIDC 上线前由本机人工发布的，从未经 CI 走过可信发布，它们的信任配置也就从未被验证过。npm 规定新建的信任配置必须在 2 天内完成首次成功发布，否则失效且不可编辑——所以「提前配好」没有意义，只能配一批、马上发一批。
  
  本补丁的唯一目的，是让这批包各完成一次经 CI 的成功发布以验证配置（验证后长期有效），**无功能变更**。
  
  不在本批的两个例外（按仓库约束不动，其信任配置留待它们真正发版的批次再验证）：
  
  - shim 四包：`@koishi-ce/koishi-shim`、`@koishi-ce/console-shim`、`@koishi-ce/client-shim`、`@koishi-ce/components-shim`（changesets ignore，版本冻结跟随上游线）
  - vendored 三包：`@koishi-ce/plugin-http`、`@koishi-ce/plugin-proxy-agent`、`@koishi-ce/plugin-server`（预编译产物包，不走 tsdown）
- Updated dependencies [e9258a1]
  - @koishi-ce/client@1.4.3
  - @koishi-ce/components@1.1.1

## 1.0.3

### Patch Changes

- Updated dependencies [74774de]
  - @koishi-ce/client@1.4.2

## 1.0.2

### Patch Changes

- Updated dependencies [9a6ea29]
  - @koishi-ce/components@1.1.0
  - @koishi-ce/client@1.4.1

## 1.0.1

### Patch Changes

- Updated dependencies [f644c05]
- Updated dependencies [549520e]
  - @koishi-ce/client@1.4.0
