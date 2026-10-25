# @koishi-ce/plugin-server

## 1.0.2

### Patch Changes

- 2f888a5: 验证 npm OIDC 信任配置：vendored 三包的 latest（1.0.1，OIDC 上线前由本机人工发布）从未经 CI 走过可信发布，其信任配置从未被验证——此前预配的记录已因超过 2 天窗口过期作废。本补丁的唯一目的，是让这三个包各完成一次经 CI 的成功发布以验证**当天新建**的信任配置（验证后长期有效），**无功能变更**。
  
  shim 四包继续按仓库约束不动：changesets `ignore`、版本冻结跟随上游线，且核查当日上游 latest 恰与四包冻结版本一致（koishi 4.18.11 / client 5.30.11 / console 5.30.11 / components 1.5.22），不存在可发的合法下一版——其信任配置留待它们真正发版的批次再验证。
- @koishi-ce/koishi@1.0.21

## 1.0.1

### Patch Changes

- 7613c69: 修复应用停机时 server 插件 dispose 回调抛 `TypeError: undefined is not an object (evaluating 'this.ctx.logger.info')` 的问题：cordis 按注册顺序 FIFO 销毁插件，logger 服务在 Context 构造期最先注册、也最先被释放（store 值置空），其后 @cordisjs/plugin-server 的 dispose 回调再读 `this.ctx.logger` 已是 undefined（上游 0.2.9 未加防护）。vendored 包装层改以带 logger 快照的 shadow ctx 装配，停机期日志照常输出；上游修复后可移除（与 core 对 satori Bot dispose 的补丁同款根因）。
- @koishi-ce/koishi@1.0.5
