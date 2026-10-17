# @koishi-ce/plugin-help

## 1.1.1

### Patch Changes

- e9258a1: 验证 npm OIDC 信任配置：本批 27 个包的 latest 仍是 OIDC 上线前由本机人工发布的，从未经 CI 走过可信发布，它们的信任配置也就从未被验证过。npm 规定新建的信任配置必须在 2 天内完成首次成功发布，否则失效且不可编辑——所以「提前配好」没有意义，只能配一批、马上发一批。
  
  本补丁的唯一目的，是让这批包各完成一次经 CI 的成功发布以验证配置（验证后长期有效），**无功能变更**。
  
  不在本批的两个例外（按仓库约束不动，其信任配置留待它们真正发版的批次再验证）：
  
  - shim 四包：`@koishi-ce/koishi-shim`、`@koishi-ce/console-shim`、`@koishi-ce/client-shim`、`@koishi-ce/components-shim`（changesets ignore，版本冻结跟随上游线）
  - vendored 三包：`@koishi-ce/plugin-http`、`@koishi-ce/plugin-proxy-agent`、`@koishi-ce/plugin-server`（预编译产物包，不走 tsdown）
- @koishi-ce/koishi@1.0.20

## 1.1.0

### Minor Changes

- f66c005: i18n: 清剿存量假翻译并新增词典检查工具
  
  - broadcast / callme / echo / help / hmr / admin / logger / status 及 core 的 prompt-argument、commands.$ 等非中文语种中的上游中文占位全部替换为真翻译（含 ja-JP 残留）
  - 新增 `bun tooling/check-locales.ts`：以 zh-CN 为基准检查全仓词典的键对齐、语种齐全与假翻译（market 等上游再分发目录按约定跳过/豁免），当前零报警

### Patch Changes

- @koishi-ce/koishi@1.0.8
