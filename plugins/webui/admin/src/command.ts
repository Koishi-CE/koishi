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
			const { user } = (options ?? {}) as Extend<{}, "user", string>;
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
		.option("remove", "-r", { descPath: "admin.options.remove" })
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
					return session.text("admin.invalid-assignee-platform");
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

function parsePlatform(target: string): [platform: string, id: string] {
	const index = target.indexOf(":");
	const platform = target.slice(0, index);
	const id = target.slice(index + 1);
	return [platform, id] as [platform: string, id: string];
}

function adminUser(command: Command) {
	let notFound: boolean;

	async function setTarget(
		argv: Argv<"authority", never, any[], Extend<{}, "user", string>>,
	) {
		const { options, session } = argv;
		if (!session) return undefined;
		const { app } = session;
		notFound = false;

		// user not specified, use current user
		if (!options?.user) return undefined;

		// spectified user is identical to current user
		const [platform, userId] = parsePlatform(options.user);
		if (session.userId === userId && session.platform === platform) {
			return undefined;
		}

		// get target user
		const fields = session.collect("user", argv);
		const data = await app.database.getUser(platform, userId, [...fields]);

		if (!data) {
			notFound = true;
			// user 表由内核启动时注册,运行时必然存在
			const temp = app.model.tables["user"]!.create();
			session.user = observe(
				temp,
				async (diff) => {
					await app.database.createUser(platform, userId, diff);
				},
				`user ${options.user}`,
			);
		} else if (session.user!.authority <= data.authority) {
			return session.text("internal.low-authority");
		} else {
			session.user = observe(
				data,
				async (diff) => {
					await app.database.setUser(platform, userId, diff);
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
			const user = session.user!;
			const output = await setTarget(argv);
			if (output) return output;
			if (!session.user) return;
			try {
				const diffKeys = Object.keys(session.user.$diff);
				const result = await next!();
				if (notFound && !command.config.admin?.upsert) {
					return session.text("admin.user-not-found");
				} else if (typeof result === "string") {
					return result;
				} else if (
					!difference(Object.keys(session.user.$diff), diffKeys).length
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

function adminChannel(command: Command) {
	let notFound: boolean;

	async function setTarget(
		argv: Argv<never, never, any[], Extend<{}, "channel", string>>,
	) {
		const { options, session } = argv;
		if (!session) return undefined;
		const { app } = session;
		notFound = false;

		// channel is required for private messages
		if (session.isDirect && !options?.channel) {
			return session.text("admin.not-in-group");
		}

		// channel not specified or identical, use current channel
		const channel = options?.channel ?? session.cid;
		// $detached 是 observe 运行时附加的标记(仅会赋 true),不在 Observed 类型中
		const current = session.channel;
		if (channel === session.cid && !(current && "$detached" in current)) {
			return undefined;
		}

		// get target channel
		const [platform, channelId] = parsePlatform(channel);
		const fields = session.collect("channel", argv);
		const data = await app.database.getChannel(platform, channelId, [
			...fields,
		]);

		if (!data) {
			notFound = true;
			// channel 表由内核启动时注册,运行时必然存在
			const temp = app.model.tables["channel"]!.create();
			temp.platform = platform;
			temp.id = channelId;
			session.channel = observe(
				temp,
				async (diff) => {
					await app.database.createChannel(platform, channelId, diff);
				},
				`channel ${channel}`,
			);
		} else {
			session.channel = observe(
				data,
				async (diff) => {
					await app.database.setChannel(platform, channelId, diff);
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
			// 该动作仅在会话中被触发,channelFields 已保证 session.channel 存在
			const channel = session.channel!;
			const output = await setTarget(argv);
			if (output) return output;
			if (!session.channel) return;
			try {
				const diffKeys = Object.keys(session.channel.$diff);
				const result = await next!();
				if (notFound && !command.config.admin?.upsert) {
					return session.text("admin.channel-not-found");
				} else if (typeof result === "string") {
					return result;
				} else if (
					!difference(Object.keys(session.channel.$diff), diffKeys).length
				) {
					return session.text("admin.channel-unchanged");
				}
				await session.channel.$update();
				return session.text("admin.channel-updated");
			} finally {
				session.channel = channel;
			}
		}, true);
}

type Key = "user" | "channel";

function adminLocale<
	U extends User.Field,
	G extends Channel.Field,
	A extends any[],
	O extends {},
>(cmd: Command<U, G, A, O>, key: Key) {
	return cmd
		.option("remove", "-r", { descPath: "admin.options.remove" })
		.action(async ({ session, options }, ...args) => {
			if (!session) return;
			const target = session[key] as { locales?: string[] };
			if (options?.remove) {
				target.locales = [];
			} else if (args[0]) {
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
