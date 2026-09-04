// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	type Argv,
	type Channel,
	type Command,
	Context,
	difference,
	type Extend,
	observe,
	type User,
} from "@koishi-ce/koishi";

/**
 * 聊天侧管理指令：
 * - `user/authorize`、`user/locale`、`channel/assign`、`channel/locale` 四条指令；
 * - 对声明了 `config.admin` 的指令注入 `-u` / `-c` 选项，
 *   使其可作用于其它用户 / 频道（adminUser / adminChannel 两个装饰器实现）。
 */

declare module "@koishi-ce/koishi" {
	namespace Command {
		interface Config {
			admin?: Config.Admin;
		}

		namespace Config {
			interface Admin {
				user?: boolean;
				channel?: boolean;
				upsert?: boolean;
			}
		}
	}
}

export default function apply(ctx: Context) {
	// 对已有 / 后续新增的指令应用管理装饰（按 config.admin 决定注入哪些能力）
	function enableAdmin(command: Command) {
		if (!command.config.admin) return;
		command[Context.current] = ctx;
		if (command.config.admin.user) adminUser(command);
		if (command.config.admin.channel) adminChannel(command);
	}

	ctx.$commander._commandList.forEach(enableAdmin);
	ctx.on("command-added", enableAdmin);

	ctx.command("user", { authority: 3 });
	ctx.command("channel", { authority: 3 });

	ctx
		.command("user/authorize <value:natural>", {
			authority: 4,
			checkUnknown: true,
			admin: { user: true, upsert: true },
		})
		.alias("auth")
		.userFields(["authority"])
		.action(async ({ options, session }, authority) => {
			if (!session) return;
			// -u 选项由下方 adminUser 动态注入,不在静态 options 类型中
			const { user } = (options ?? {}) as Extend<
				object,
				"user",
				string
			>;
			if (!user) {
				return session.text("admin.user-expected");
			}
			if (!session.user) return;
			session.user.authority = authority;
			return undefined;
		});

	ctx
		.command("user.locale <lang>", {
			authority: 1,
			checkUnknown: true,
			admin: { user: true },
		})
		.userFields(["locales"])
		.use(adminLocale, "user");

	ctx
		.command("channel/assign [bot:user]", {
			authority: 4,
			checkUnknown: true,
			admin: { channel: true, upsert: true },
		})
		.channelFields(["assignee"])
		.option("remove", "-r", {
			descPath: "admin.options.remove",
		})
		.action(async ({ session, options }, value) => {
			if (!session) return;
			if (!session.channel) return;
			if (options?.remove) {
				session.channel.assignee = "";
			} else if (!value) {
				session.channel.assignee = session.selfId;
			} else {
				const [platform, userId] = parsePlatform(value);
				if (platform !== session.platform) {
					return session.text(
						"admin.invalid-assignee-platform",
					);
				}
				session.channel.assignee = userId;
			}
			return undefined;
		});

	ctx
		.command("channel.locale <lang>", {
			authority: 3,
			checkUnknown: true,
			admin: { channel: true },
		})
		.channelFields(["locales"])
		.use(adminLocale, "channel");
}

/** 拆分 "platform:id" 形式的目标标识。 */
function parsePlatform(
	target: string,
): [platform: string, id: string] {
	const index = target.indexOf(":");
	const platform = target.slice(0, index);
	const id = target.slice(index + 1);
	return [platform, id] as [platform: string, id: string];
}

/**
 * 指令的「用户管理」装饰器：注入 `-u [user:user]` 选项，
 * 让指令可以把 session.user 临时切换为数据库中的目标用户（观察者代理，
 * 差异自动落库），执行完毕后恢复原用户。返回包装了前置 / 后置逻辑的新指令。
 */
function adminUser(command: Command) {
	let notFound: boolean;

	/**
	 * 前置处理：按 -u 选项把 session.user 换成目标用户。
	 * 目标不存在时用空模板创建观察者（配合 upsert 决定是报错还是建档）；
	 * 目标权限不低于操作者时拒绝操作。
	 */
	async function setTarget(
		argv: Argv<
			"authority",
			never,
			unknown[],
			Extend<object, "user", unknown>
		>,
	) {
		const { options, session } = argv;
		if (!session) return undefined;
		const { app } = session;
		notFound = false;

		// 未指定目标用户时，直接作用于当前用户
		if (!options?.user) return undefined;

		// 指定的目标用户就是当前用户（-u [user:user] 保证运行时为 string）
		const [platform, userId] = parsePlatform(
			options.user as string,
		);
		if (
			session.userId === userId &&
			session.platform === platform
		) {
			return undefined;
		}

		// 读取目标用户数据
		const fields = session.collect("user", argv);
		const data = await app.database.getUser(
			platform,
			userId,
			[...fields],
		);

		if (!data) {
			notFound = true;
			// user 表由内核启动时注册,运行时必然存在,缺失视为致命错误
			const table = app.model.tables["user"];
			if (!table)
				throw new Error("table user is not registered");
			const temp = table.create();
			session.user = observe(
				temp,
				async (diff) => {
					await app.database.createUser(
						platform,
						userId,
						diff,
					);
				},
				`user ${options.user}`,
			);
		} else if (
			session.user &&
			session.user.authority <= data.authority
		) {
			return session.text("internal.low-authority");
		} else {
			session.user = observe(
				data,
				async (diff) => {
					await app.database.setUser(
						platform,
						userId,
						diff,
					);
				},
				`user ${options.user}`,
			);
		}
		return undefined;
	}

	return command
		.option("user", "-u [user:user]", {
			authority: 3,
			descPath: "admin.user-option",
		})
		.userFields(["authority"])
		.action(async (argv, ..._args) => {
			const { session, next } = argv;
			if (!session) return;
			// 该动作仅在会话中被触发,userFields 已保证 session.user 存在
			if (!session.user) return;
			const user = session.user;
			const output = await setTarget(argv);
			if (output) return output;
			if (!session.user) return;
			try {
				const diffKeys = Object.keys(session.user.$diff);
				const result = await next?.();
				if (notFound && !command.config.admin?.upsert) {
					return session.text("admin.user-not-found");
				} else if (typeof result === "string") {
					return result;
				} else if (
					!difference(
						Object.keys(session.user.$diff),
						diffKeys,
					).length
				) {
					return session.text("admin.user-unchanged");
				} else if (
					session.user !== user &&
					session.user.authority >= user.authority
				) {
					return session.text("internal.low-authority");
				}
				await session.user.$update();
				return session.text("admin.user-updated");
			} finally {
				session.user = user;
			}
		}, true);
}

/**
 * 指令的「频道管理」装饰器：注入 `-c [channel:channel]` 选项，
 * 让指令可以把 session.channel 临时切换为目标频道（观察者代理，差异自动落库），
 * 执行完毕后恢复原频道。私聊场景必须显式指定 -c。
 */
function adminChannel(command: Command) {
	let notFound: boolean;

	/**
	 * 前置处理：按 -c 选项把 session.channel 换成目标频道。
	 * 目标不存在时用空模板创建观察者（配合 upsert 决定是报错还是建档）。
	 */
	async function setTarget(
		argv: Argv<
			never,
			never,
			unknown[],
			Extend<object, "channel", unknown>
		>,
	) {
		const { options, session } = argv;
		if (!session) return undefined;
		const { app } = session;
		notFound = false;

		// 私聊没有频道上下文，必须显式指定目标频道
		if (session.isDirect && !options?.channel) {
			return session.text("admin.not-in-group");
		}

		// 未指定目标频道或与当前频道相同时，直接作用于当前频道
		const channel = options?.channel ?? session.cid;
		// $detached 是 observe 运行时附加的标记(仅会赋 true),不在 Observed 类型中
		const current = session.channel;
		if (
			channel === session.cid &&
			!(current && "$detached" in current)
		) {
			return undefined;
		}

		// 读取目标频道数据（-c [channel:channel] 保证选项运行时为 string）
		const [platform, channelId] = parsePlatform(
			channel as string,
		);
		const fields = session.collect("channel", argv);
		const data = await app.database.getChannel(
			platform,
			channelId,
			[...fields],
		);

		if (!data) {
			notFound = true;
			// channel 表由内核启动时注册,运行时必然存在,缺失视为致命错误
			const table = app.model.tables["channel"];
			if (!table)
				throw new Error("table channel is not registered");
			const temp = table.create();
			temp.platform = platform;
			temp.id = channelId;
			session.channel = observe(
				temp,
				async (diff) => {
					await app.database.createChannel(
						platform,
						channelId,
						diff,
					);
				},
				`channel ${channel}`,
			);
		} else {
			session.channel = observe(
				data,
				async (diff) => {
					await app.database.setChannel(
						platform,
						channelId,
						diff,
					);
				},
				`channel ${channel}`,
			);
		}
		return undefined;
	}

	return command
		.option("channel", "-c [channel:channel]", {
			authority: 3,
			descPath: "admin.channel-option",
		})
		.action(async (argv, ..._args) => {
			const { session, next } = argv;
			if (!session) return;
			// 私聊可能没有频道上下文（此时交由 setTarget 的 isDirect 分支报错），
			// channel 仅作为执行完毕后的恢复引用，可空保存
			const channel = session.channel;
			const output = await setTarget(argv);
			if (output) return output;
			if (!session.channel) return;
			try {
				const diffKeys = Object.keys(session.channel.$diff);
				const result = await next?.();
				if (notFound && !command.config.admin?.upsert) {
					return session.text("admin.channel-not-found");
				} else if (typeof result === "string") {
					return result;
				} else if (
					!difference(
						Object.keys(session.channel.$diff),
						diffKeys,
					).length
				) {
					return session.text("admin.channel-unchanged");
				}
				await session.channel.$update();
				return session.text("admin.channel-updated");
			} finally {
				if (channel !== undefined) {
					session.channel = channel;
				} else {
					// 私聊原本就没有频道上下文，清除 setTarget 可能换上的观察代理
					// （exactOptionalPropertyTypes 下可选属性的 undefined 恢复写法）
					delete session.channel;
				}
			}
		}, true);
}

type Key = "user" | "channel";

/**
 * locale 子指令的公共实现：设置 / 清除目标用户或频道的第一语言，
 * 不带参数时查询当前设置。
 * @param cmd 待挂载 action 的指令
 * @param key 操作目标是 user 还是 channel（决定读写 session 的哪个字段）
 */
function adminLocale<
	U extends User.Field,
	G extends Channel.Field,
	A extends unknown[],
	O extends {},
>(cmd: Command<U, G, A, O>, key: Key) {
	return cmd
		.option("remove", "-r", {
			descPath: "admin.options.remove",
		})
		.action(async ({ session, options }, ...args) => {
			if (!session) return;
			const target = session[key] as { locales?: string[] };
			if (options?.remove) {
				target.locales = [];
			} else if (typeof args[0] === "string") {
				target.locales = [args[0]];
			} else if (target.locales?.length) {
				return session.text("admin.current-locale", [
					target.locales.join(", "),
				]);
			} else {
				return session.text("admin.no-locale");
			}
			return undefined;
		});
}
