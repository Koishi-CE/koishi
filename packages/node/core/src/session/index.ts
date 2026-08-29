/**
 * 会话（Session）模块入口——Koishi 事件处理的核心载体。
 *
 * KoishiSession 在 satori 协议层 Session 的基础上，按职责拆成一条
 * 继承链（自底向上逐层叠加能力）：
 *
 * core（来源解析与前缀剥离）→ messaging（发送与限速队列）→
 * observe（频道/用户数据装配缓存）→ locale（作用域与 i18n）→
 * execute（字段收集与命令执行）→ interact（会话中间件、追问与建议）。
 *
 * 公共接口与辅助类型在 types.ts；本文件负责组装最终类并通过
 * ctx.mixin 把方法注册为 `session.*` 服务方法，导出面保持不变。
 */
import type { Context } from "../context/index.ts";
import { SessionInteractive } from "./interact.ts";

export { SessionCore } from "./core.ts";
export { SessionExecutable } from "./execute.ts";
export { SessionInteractive } from "./interact.ts";
export { SessionLocalized } from "./locale.ts";
export { SessionMessaging } from "./messaging.ts";
export { SessionObservable } from "./observe.ts";
export * from "./types.ts";

/** Koishi 会话最终类：继承全部能力层，构造时完成服务方法注册。 */
class KoishiSession<C extends Context> extends SessionInteractive {
	constructor(ctx: C) {
		super();
		// 将实例方法注册为 ctx 上的服务（session.xxx），
		// 插件内可通过依赖注入以 this.session.send 等方式调用
		ctx.mixin(this, {
			resolve: "session.resolve",
			stripped: "session.stripped",
			username: "session.username",
			send: "session.send",
			cancelQueued: "session.cancelQueued",
			sendQueued: "session.sendQueued",
			getChannel: "session.getChannel",
			observeChannel: "session.observeChannel",
			getUser: "session.getUser",
			observeUser: "session.observeUser",
			withScope: "session.withScope",
			resolveScope: "session.resolveScope",
			text: "session.text",
			i18n: "session.i18n",
			collect: "session.collect",
			execute: "session.execute",
			middleware: "session.middleware",
			prompt: "session.prompt",
			suggest: "session.suggest",
		});
	}
}

export default KoishiSession;
