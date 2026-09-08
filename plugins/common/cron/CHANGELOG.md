# @koishi-ce/plugin-cron

## 1.1.0

### Minor Changes

- f3ee39d: 新增 cron 计划任务插件：`ctx.cron(input, callback)` 服务，基于 Bun.cron 原生调度——无 cron-parser 依赖、免疫上游 setTimeout 32 位溢出缺陷（koishijs/koishi-plugin-cron#8），支持 tz 时区配置与任务取消。
