---
"@koishi-ce/assets": patch
"@koishi-ce/client": patch
"@koishi-ce/components": patch
"@koishi-ce/console": patch
"@koishi-ce/console-app": patch
"@koishi-ce/i18n-utils": patch
"@koishi-ce/loader": patch
"@koishi-ce/plugin-actions": patch
"@koishi-ce/plugin-assets-local": patch
"@koishi-ce/plugin-bind": patch
"@koishi-ce/plugin-broadcast": patch
"@koishi-ce/plugin-callme": patch
"@koishi-ce/plugin-database-memory": patch
"@koishi-ce/plugin-database-sqlite": patch
"@koishi-ce/plugin-echo": patch
"@koishi-ce/plugin-help": patch
"@koishi-ce/plugin-hmr": patch
"@koishi-ce/plugin-inspect": patch
"@koishi-ce/plugin-mock": patch
"@koishi-ce/plugin-notifier": patch
"@koishi-ce/plugin-oobe": patch
"@koishi-ce/plugin-rate-limit": patch
"@koishi-ce/plugin-server-temp": patch
"@koishi-ce/plugin-theme-vanilla": patch
"@koishi-ce/plugin-welcome": patch
"@koishi-ce/registry": patch
"@koishi-ce/scripts": patch
---

验证 npm OIDC 信任配置：本批 27 个包的 latest 仍是 OIDC 上线前由本机人工发布的，从未经 CI 走过可信发布，它们的信任配置也就从未被验证过。npm 规定新建的信任配置必须在 2 天内完成首次成功发布，否则失效且不可编辑——所以「提前配好」没有意义，只能配一批、马上发一批。

本补丁的唯一目的，是让这批包各完成一次经 CI 的成功发布以验证配置（验证后长期有效），**无功能变更**。

不在本批的两个例外（按仓库约束不动，其信任配置留待它们真正发版的批次再验证）：

- shim 四包：`@koishi-ce/koishi-shim`、`@koishi-ce/console-shim`、`@koishi-ce/client-shim`、`@koishi-ce/components-shim`（changesets ignore，版本冻结跟随上游线）
- vendored 三包：`@koishi-ce/plugin-http`、`@koishi-ce/plugin-proxy-agent`、`@koishi-ce/plugin-server`（预编译产物包，不走 tsdown）
