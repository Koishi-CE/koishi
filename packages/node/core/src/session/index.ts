import type { Context } from "../context";
import { SessionInteractive } from "./interact";

export { SessionCore } from "./core";
export { SessionExecutable } from "./execute";
export { SessionInteractive } from "./interact";
export { SessionLocalized } from "./locale";
export { SessionMessaging } from "./messaging";
export { SessionObservable } from "./observe";
export * from "./types";

class KoishiSession<C extends Context> extends SessionInteractive {
	constructor(ctx: C) {
		super();
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
