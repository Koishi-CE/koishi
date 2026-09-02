---
"@koishi-ce/loader": patch
---

修复三处被测试噪声掩盖的产品缺陷：

- `createApp` 中 `provide("baseDir")` 被 cordis 3.18 构造器自带的 `baseDir = cwd()` 自有属性遮蔽，插件读到的 `ctx.baseDir` 恒为进程 cwd 而非配置文件目录；现改为在 provide 之前直接赋值（provide 之后该属性会被访问子接管、裸赋值失效）。
- 根作用域停机/销毁期间，插件的批量卸载不再回写为 `~` 前缀键并触发写盘——此前该路径仅靠 logger 崩溃与 `process.exit` 抢在防抖落盘之前才未造成「整份配置被停用」的事故。
- 插件生命周期日志（apply/unload/reload）在停机销毁期 logger 服务已释放时不再抛 TypeError。
