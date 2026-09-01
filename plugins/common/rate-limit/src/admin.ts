// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 频率限制管理指令（usage-admin）。
 *
 * 提供 `usage` 与 `timer` 两个指令（set / clear 子操作需权限 4），
 * 查看与修改当前用户的调用计数与定时器数据。
 */
import type { Context } from "@koishi-ce/koishi";

export const name = "usage-admin";

export function apply(ctx: Context) {
	ctx
		.command("usage [key] [value:posint]")
		.userFields(["usage"])
		.option("set", "-s", { authority: 4 })
		.option("clear", "-c", { authority: 4 })
		.action(({ session, options = {} }, name, count) => {
			if (!session) return;
			const { user } = session;
			if (!user) return;
			if (options.clear) {
				if (name) delete user.usage[name];
				else user.usage = {};
				return session.text(".updated");
			}

			if (options.set) {
				if (!count || !name) {
					return session.text("internal.insufficient-arguments");
				}
				user.usage[name] = count;
				return session.text(".updated");
			}

			if (name) {
				return session.text(".present", [name, user.usage[name] || 0]);
			}
			const output: string[] = [];
			for (const key of Object.keys(user.usage).sort()) {
				if (key.startsWith("_")) continue;
				output.push(`${key}：${user.usage[key]}`);
			}
			if (!output.length) return session.text(".none");
			output.unshift(session.text(".list"));
			return output.join("\n");
		});

	ctx
		.command("timer [key] [value:date]")
		.userFields(["timers"])
		.option("set", "-s", { authority: 4 })
		.option("clear", "-c", { authority: 4 })
		.action(({ session, options = {} }, name, value) => {
			if (!session) return;
			const { user } = session;
			if (!user) return;
			if (options.clear) {
				if (name) delete user.timers[name];
				else user.timers = {};
				return session.text(".updated");
			}

			if (options.set) {
				if (!value || !name) {
					return session.text("internal.insufficient-arguments");
				}
				user.timers[name] = +value;
				return session.text(".updated");
			}

			const now = Date.now();
			if (name) {
				// 缺少记录时按已过期处理（差值为负）
				const delta = (user.timers[name] ?? 0) - now;
				if (delta > 0) return session.text(".present", [name, delta]);
				return session.text(".absent", [name]);
			}
			const output: string[] = [];
			for (const key of Object.keys(user.timers).sort()) {
				if (key.startsWith("_")) continue;
				const delta = (user.timers[key] ?? 0) - now;
				if (delta > 0) {
					output.push(session.text(".item", [key, delta]));
				}
			}
			if (!output.length) return session.text(".none");
			output.unshift(session.text(".list"));
			return output.join("\n");
		});
}
