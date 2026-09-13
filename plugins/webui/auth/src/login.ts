// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// upstream: koishijs/webui plugins/auth/src/index.ts initLogin 段（上游为单文件 plugin-auth 4.1.7，本仓拆分时抽离至本文件并参数化 this→auth，同步时以其整体 diff 对照本目录）

import { randomInt } from "node:crypto";
import type { Client } from "@koishi-ce/console";
import { type Context, omit } from "@koishi-ce/koishi";
import { toHash, verifyPassword } from "./crypto.ts";
import type AuthService from "./index.ts";

/** 注册全部登录 / 用户管理事件与权限拦截逻辑（构造时调用）。 */
export function initLogin(auth: AuthService) {
	const self = auth;
	// Service 基类的 ctx 为 protected,initLogin 拆出类体外后不可直接
	// 点访问;以交叉类型视图标注解构来源(运行时仍取实例上的同一属性,
	// 无任何行为差异),config 本为公开成员,一并随解构取出
	const { ctx, config } = auth as AuthService & {
		ctx: Context;
	};
	// 平台验证码登录的进行中状态：键为 `${platform}:${userId}`，
	// 值为 [验证码, 过期时间, 发起登录的客户端]
	const states: Record<string, [string, number, Client]> =
		{};

	// 用户密码登录：校验通过后签发新令牌
	ctx.console.addListener(
		"login/password",
		async function (name, password) {
			const [user] = await ctx.database.get(
				"user",
				{ name },
				["password", "name", "id", "authority", "config"],
			);
			if (
				!user?.password ||
				!verifyPassword(password, user.password)
			)
				throw new Error("用户名或密码错误。");
			await self.createToken(
				this,
				"password",
				omit(user, ["password"]),
			);
		},
	);

	// 已存令牌续期登录：本地记录的令牌未过期即恢复登录态，
	// 同时刷新该令牌的最后访问时间
	ctx.console.addListener(
		"login/token",
		async function (aid, token) {
			const [data] = await ctx.database.get(
				"token",
				{ id: aid, token },
				["expiredAt"],
			);
			if (!data || data.expiredAt <= Date.now())
				throw new Error("令牌已失效。");
			const [user] = await ctx.database.get(
				"user",
				{ id: aid },
				["id", "name", "authority", "config"],
			);
			if (!user) throw new Error("用户不存在。");
			await ctx.database.set(
				"token",
				{ token },
				{ lastUsedAt: new Date() },
			);
			await self.setAuth(this, {
				...user,
				...data,
				token,
			});
		},
	);

	// 平台账户登录（第一步）：校验平台账号存在后生成一次性验证码，
	// 用户把验证码发给任意机器人即可完成登录/绑定（见下方中间件）。
	// 状态在验证码过期或客户端断开时清理
	ctx.console.addListener(
		"login/platform",
		async function (platform, userId) {
			const user = await ctx.database.getUser(
				platform,
				userId,
				["id", "name"],
			);
			if (!user) throw new Error("找不到此账户。");
			if (this.auth?.id === user.id)
				throw new Error("你已经绑定了此账户。");

			const key = `${platform}:${userId}`;
			// 固定 6 位数字验证码（padStart 补零）；原 Math.random 实现
			// 在短小数串时不足 6 位，且非 CSPRNG
			const token = String(
				randomInt(0, 1_000_000),
			).padStart(6, "0");
			const expiredAt =
				Date.now() + config.loginTokenExpire;
			states[key] = [token, expiredAt, this];

			// 客户端断开或验证码超时即作废本次登录状态
			const listener = () => {
				delete states[key];
				dispose();
				this.socket.removeEventListener("close", dispose);
			};
			const dispose = ctx.setTimeout(() => {
				const state = states[key];
				if (state && state[1] >= Date.now()) listener();
			}, config.loginTokenExpire);
			this.socket.addEventListener("close", listener);

			return {
				id: user.id,
				name: user.name,
				token,
				expiredAt,
			};
		},
	);

	// 平台账户登录（第二步）：前置中间件捕获用户发给机器人的验证码——
	// 客户端已登录则把该平台账号绑定到当前用户，否则为平台对应用户签发令牌
	ctx.middleware(async (session, next) => {
		const state = states[session.uid];
		if (!state || state[0] !== session.stripped.content) {
			return next();
		}

		const { platform, userId: pid } = session;
		// states 的键由 `${platform}:${userId}` 构成,能命中即说明 userId 存在
		if (!pid) return next();
		if (state[2].auth) {
			await ctx.database.set(
				"binding",
				{ platform, pid },
				{ aid: state[2].auth.id },
			);
			return self.setAuth(state[2], state[2].auth);
		} else {
			const user = await session.observeUser([
				"id",
				"name",
				"authority",
				"config",
			]);
			return self.createToken(state[2], "platform", user);
		}
	}, true);

	// 拦截带 authority 要求的 console 事件：未登录、令牌过期或
	// 权限不足时拒绝（返回 true 表示拦截）
	ctx.on("console/intercept", async (client, listener) => {
		if (!listener.authority) return false;
		if (!client.auth) return true;
		if (client.auth.expiredAt <= Date.now()) return true;
		if (client.auth.authority < listener.authority)
			return true;
		return false;
	});

	// 删除指定登录会话（登出其它设备）
	ctx.console.addListener(
		"user/delete-token",
		async function (inc) {
			if (!this.auth) throw new Error("请先登录。");
			const [data] = await ctx.database.get("token", {
				id: this.auth.id,
				inc,
			});
			if (!data) throw new Error("令牌不存在。");
			await ctx.database.remove("token", { inc });
			await self.setAuth(this);
		},
	);

	// 退出登录：删除当前令牌并清除登录态
	ctx.console.addListener("user/logout", async function () {
		if (this.auth) {
			await ctx.database.remove("token", {
				token: this.auth.token,
			});
		}
		await self.setAuth(this, undefined);
	});

	// 修改用户资料（用户名 / 密码 / 配置），密码先哈希再落库
	ctx.console.addListener(
		"user/update",
		async function (data) {
			if (!this.auth) throw new Error("请先登录。");
			if (data.password)
				data.password = toHash(data.password);
			await ctx.database.set(
				"user",
				{ id: this.auth.id },
				data,
			);
			Object.assign(this.auth, data);
			await self.setAuth(this, undefined, true);
		},
	);

	// 解绑平台账号：绑到别的用户时改指回其主账号；是自身主账号且
	// 仅剩一个自绑定时拒绝解绑（避免用户失去登录途径），否则删除记录
	ctx.console.addListener(
		"user/unbind",
		async function (platform, pid) {
			if (!this.auth) throw new Error("请先登录。");
			const bindings = await ctx.database.get("binding", {
				aid: this.auth.id,
			});
			// 客户端仅对已列出的绑定发起解绑,查找必命中,未命中视为异常状态
			const binding = bindings.find(
				(item) =>
					item.platform === platform && item.pid === pid,
			);
			if (!binding) throw new Error("绑定不存在。");
			if (binding.aid !== binding.bid) {
				await ctx.database.set(
					"binding",
					{ platform, pid },
					{ aid: binding.bid },
				);
			} else if (
				bindings.filter((item) => item.aid === item.bid)
					.length === 1
			) {
				throw new Error("无法解除绑定。");
			} else {
				await ctx.database.remove("binding", {
					platform,
					pid,
				});
			}
			await self.setAuth(this);
		},
	);
}
