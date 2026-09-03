// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import Server from "@cordisjs/plugin-server";

// cordis 停机按插件注册顺序 FIFO 销毁：logger 服务在 Context 构造期最先注册、也最先
// 销毁（store 值被置空），其后 @cordisjs/plugin-server 的 dispose 回调再读
// this.ctx.logger 已是 undefined（0.2.9 未加防护），导致 app.stop() 时抛 TypeError。
// 这里传入带 logger 快照的 shadow ctx，让自有属性直接命中、绕开停机期的服务解析。
// （快照不能经 ctx.extend 的 meta 赋值——那会触发服务名 set 校验，须 defineProperty。）
// 上游修复后可移除（与 core 对 satori Bot.prototype.dispose 的补丁同款根因）。
export default class ServerWithLoggerGuard extends Server {
	constructor(ctx, config) {
		const shadow = ctx.extend({});
		Object.defineProperty(shadow, "logger", { value: ctx.logger });
		super(shadow, config);
	}
}

export * from "@cordisjs/plugin-server";
