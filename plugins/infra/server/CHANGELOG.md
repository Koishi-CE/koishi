# @koishi-ce/plugin-server

## 1.0.1

### Patch Changes

- 7613c69: 修复应用停机时 server 插件 dispose 回调抛 `TypeError: undefined is not an object (evaluating 'this.ctx.logger.info')` 的问题：cordis 按注册顺序 FIFO 销毁插件，logger 服务在 Context 构造期最先注册、也最先被释放（store 值置空），其后 @cordisjs/plugin-server 的 dispose 回调再读 `this.ctx.logger` 已是 undefined（上游 0.2.9 未加防护）。vendored 包装层改以带 logger 快照的 shadow ctx 装配，停机期日志照常输出；上游修复后可移除（与 core 对 satori Bot dispose 的补丁同款根因）。
- @koishi-ce/koishi@1.0.5
