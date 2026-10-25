---
"@koishi-ce/plugin-http": patch
"@koishi-ce/plugin-proxy-agent": patch
"@koishi-ce/plugin-server": patch
---

验证 npm OIDC 信任配置：vendored 三包的 latest（1.0.1，OIDC 上线前由本机人工发布）从未经 CI 走过可信发布，其信任配置从未被验证——此前预配的记录已因超过 2 天窗口过期作废。本补丁的唯一目的，是让这三个包各完成一次经 CI 的成功发布以验证**当天新建**的信任配置（验证后长期有效），**无功能变更**。

shim 四包继续按仓库约束不动：changesets `ignore`、版本冻结跟随上游线，且核查当日上游 latest 恰与四包冻结版本一致（koishi 4.18.11 / client 5.30.11 / console 5.30.11 / components 1.5.22），不存在可发的合法下一版——其信任配置留待它们真正发版的批次再验证。
