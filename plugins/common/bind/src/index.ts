// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 账号绑定插件（bind）。
 *
 * 提供跨平台账号绑定：在源平台执行 `bind` 获取一次性令牌，
 * 前往目标平台发送令牌完成绑定（群聊需要两步互发令牌，私聊一步到位）。
 * 指令：`bind`（`-r` 解除当前平台账号的绑定）。
 * 依赖数据库（binding / user 表），令牌默认 5 分钟过期。
 */
import type { Context, Dict, Session } from "@koishi-ce/koishi";
import { Schema, Time } from "@koishi-ce/koishi";
import enUS from "../locales/en-US.yml";
import zhCN from "../locales/zh-CN.yml";

/** 配置项 */
export interface Config {
	/** 令牌前缀，默认 `koishi/` */
	tokenPrefix?: string;
	/** 自定义令牌生成器（测试中可注入确定性实现） */
	generateToken?: () => string;
}

export const name = "bind";
export const inject = ["database"];
export const Config: Schema<Config> = Schema.object({
	generateToken: Schema.function().hidden(),
});

/** 基于密码学安全的随机字节生成指定长度的纯数字串（250 以上的字节拒绝采样，保证分布均匀） */
function randomDigits(length: number) {
	const result: string[] = [];
	while (result.length < length) {
		const bytes = new Uint8Array(length - result.length);
		globalThis.crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte < 250) result.push(String(byte % 10));
		}
	}
	return result.join("");
}

export function apply(ctx: Context, config: Config = {}) {
	ctx.i18n.define("zh-CN", zhCN);
	ctx.i18n.define("en-US", enUS);

	// 令牌 phase 含义：1 = 群聊第一步（源平台签发）；0 = 私聊（一步完成）；-1 = 群聊第二步（目标平台签发）
	type TokenData = [platform: string, id: string, phase: number];
	const tokens: Dict<TokenData> = Object.create(null);

	const { tokenPrefix: prefix = "koishi/" } = config;
	const { generateToken = () => `${prefix}${randomDigits(6)}` } = config;

	/** 为当前会话用户签发一次性令牌并记录 phase，5 分钟后自动过期 */
	function generate(session: Session, phase: number) {
		const { userId } = session;
		if (!userId) return;
		const token = generateToken();
		tokens[token] = [session.platform, userId, phase];
		ctx.setTimeout(() => delete tokens[token], 5 * Time.minute);
		return token;
	}

	/** 将平台账号（platform + pid）绑定到指定用户（aid）名下 */
	async function bind(aid: number, platform: string, pid: string) {
		await ctx.database.set("binding", { platform, pid }, { aid });
	}

	ctx
		.command("bind", { authority: 0 })
		.userFields(["id"])
		.option("remove", "-r")
		.action(async ({ session, options }) => {
			if (!session || !options) return;
			if (options.remove) {
				const { platform, userId: pid, user } = session;
				if (!pid || !user) return;
				const bindings = await ctx.database.get("binding", {
					aid: user.id,
				});
				const binding = bindings.find(
					(item) => item.platform === platform && item.pid === pid,
				);
				if (!binding) return;
				if (binding.aid !== binding.bid) {
					// 该账号是从别的用户迁移绑定而来：恢复其原初绑定即可
					await bind(binding.bid, platform, pid);
					return session.text(".remove-success");
				} else if (
					bindings.filter((item) => item.aid === item.bid).length === 1
				) {
					// 原初绑定只剩最后一个时不允许解绑，否则用户将失去入口
					return session.text(".remove-original");
				} else {
					// 另建一个新用户（按 autoAuthorize 赋初始权限），把当前平台账号归入其名下
					const authority = await session.resolve(
						ctx.root.config.autoAuthorize,
					);
					const user = await ctx.database.create("user", { authority });
					await bind(user.id, platform, pid);
					return session.text(".remove-success");
				}
			}

			// 群聊进入两步流程（phase 1），私聊一步完成（phase 0）
			const token = generate(session, +!session.isDirect);
			return session.text(".generated-1", [token]);
		});

	// 前置中间件：拦截形如令牌的消息，驱动绑定流程
	ctx.middleware(async (session, next) => {
		const token = session.stripped.content;
		const data = tokens[token];
		if (!data) return next();
		const { userId } = session;
		if (!userId) return next();
		// 令牌在同一账号上被重复使用：提示不要在同一平台输入
		if (data[0] === session.platform && data[1] === session.userId) {
			return session.text(
				`commands.bind.messages.self-${data[2] < 0 ? "2" : "1"}`,
			);
		}
		delete tokens[token];
		if (data[2] < 0) {
			// 第二步令牌：把当前用户并入令牌签发者所属的用户
			const [binding] = await ctx.database.get(
				"binding",
				{ platform: data[0], pid: data[1] },
				["aid"],
			);
			if (!binding) return;
			await bind(binding.aid, session.platform, userId);
			return session.text("commands.bind.messages.success");
		} else {
			// 第一步令牌 / 私聊令牌：以当前用户为主体，把令牌签发账号并入自己
			const user = await ctx.database.getUser(session.platform, userId, [
				"id",
				"authority",
			]);
			// 未注册（无 authority）的账号无权拉人绑定
			if (!user.authority) return session.text("internal.low-authority");
			if (data[2]) {
				// 群聊第一步：签发第二枚令牌，请对方回原平台输入
				const token = generate(session, -1);
				return session.text("commands.bind.messages.generated-2", [token]);
			} else {
				// 私聊一步：直接把令牌签发账号并入当前用户
				await bind(user.id, data[0], data[1]);
				return session.text("commands.bind.messages.success");
			}
		}
	}, true);
}
