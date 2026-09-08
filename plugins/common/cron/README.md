# @koishi-ce/plugin-cron

简体中文 | [English](#english)

## 简介

为 Koishi 注入 `ctx.cron(input, callback)` 服务：按 cron 表达式注册计划任务，返回取消函数。

基于 Bun 内置的 `Bun.cron` 原生调度实现，不引入任何第三方 cron 解析依赖，天然免疫上游实现中「间隔超过 24.8 天的任务因 `setTimeout` 32 位溢出而立即风暴执行直至崩死」的缺陷（[koishijs/koishi-plugin-cron#8](https://github.com/koishijs/koishi-plugin-cron/issues/8)）。

源自 [koishijs/koishi-plugin-cron](https://github.com/koishijs/koishi-plugin-cron)（shigma，MIT），并参考 [cron-fix](https://github.com/koishi-shangxue-plugins/service-more/tree/main/packages/cron-fix)（shangxue）的修复思路以 Bun.cron 重写。

## 用法

```ts
export function apply(ctx: Context) {
	const dispose = ctx.cron("0 0 * * *", async () => {
		// 每天 0 点执行
	});
	// dispose() 取消任务；注册它的 ctx 销毁时任务自动停止
}
```

回调支持异步；抛出的错误会被捕获并记入 `cron` 域日志，不影响后续调度。

## 表达式语法

标准 5 字段（分 时 日 月 周），支持 `@hourly` / `@daily` / `@weekly` / `@monthly` / `@yearly` 宏。不支持秒字段与 `L` / `W` / `#` 修饰符；无效表达式在注册时抛出 `TypeError`。

## 配项

- `tz`：解析表达式所用的 IANA 时区名（如 `Asia/Shanghai`），留空使用系统本地时区。

## 许可

MIT

## English

A `ctx.cron(input, callback)` service for Koishi: register scheduled tasks with cron expressions and get a dispose function back.

Built on Bun's native `Bun.cron` scheduler with no third-party cron parser dependency, it is inherently immune to the upstream defect where tasks scheduled more than ~24.8 days ahead fire immediately in a runaway loop due to the 32-bit `setTimeout` overflow ([koishijs/koishi-plugin-cron#8](https://github.com/koishijs/koishi-plugin-cron/issues/8)).

Derived from [koishijs/koishi-plugin-cron](https://github.com/koishijs/koishi-plugin-cron) (by shigma, MIT) and rewritten on top of `Bun.cron` with fixes informed by [cron-fix](https://github.com/koishi-shangxue-plugins/service-more/tree/main/packages/cron-fix) (by shangxue).

### Usage

```ts
export function apply(ctx: Context) {
	const dispose = ctx.cron("0 0 * * *", async () => {
		// runs daily at midnight
	});
	// dispose() cancels the task; it is also stopped automatically
	// when the registering context is disposed
}
```

Callbacks may be async; thrown errors are caught and logged under the `cron` domain without affecting subsequent runs.

### Expression syntax

Standard 5 fields (minute hour day month weekday) plus the `@hourly` / `@daily` / `@weekly` / `@monthly` / `@yearly` macros. Second fields and `L` / `W` / `#` modifiers are not supported; invalid expressions throw a `TypeError` at registration.

### Config

- `tz`: IANA time-zone name used to interpret the schedule (e.g. `Asia/Shanghai`); defaults to the system local time zone.

## License

MIT
