/**
 * 会话数据装配层：频道与用户数据的获取、创建与观察缓存。
 *
 * getXxx 只做一次性查询（记录不存在时按 autoAssign / autoAuthorize
 * 配置决定是否入库创建）；observeXxx 在此之上包装 observe 观察对象，
 * 修改会在事件循环收尾时自动 diff 写回数据库（见 middleware/index.ts）。
 * 未入库的"游离"数据带 $detached 标记，写回前被拦截。
 */
import { observe } from "@koishi-ce/utils";
import type { Channel, User } from "../database/index.ts";
import { SessionMessaging } from "./messaging.ts";

/** 会话数据装配层：频道与用户数据的获取、创建与观察缓存 */
export class SessionObservable extends SessionMessaging {
	/**
	 * 查询频道记录。
	 *
	 * 不要字段时返回仅含标识信息的轻量对象（不查库）；
	 * 记录不存在时：开了 autoAssign 则入库创建并指派给本机器人，
	 * 否则返回带 `$detached` 标记的游离对象（修改不会落库）。
	 */
	override async getChannel<K extends Channel.Field = never>(
		id = this.channelId ?? "",
		fields: K[] = [],
	): Promise<Channel> {
		const { app, platform, guildId } = this;
		if (!fields.length) return { platform, id, guildId } as Channel;
		const channel = await app.database.getChannel(platform, id, fields);
		if (channel) return channel as unknown as Channel;
		const assignee = this.resolve(app.koishi.config.autoAssign ?? true)
			? this.selfId
			: "";
		if (assignee) {
			return app.database.createChannel(platform, id, {
				assignee,
				guildId: guildId ?? "",
				createdAt: new Date(),
			});
		} else {
			// 游离频道：仅存在于内存，写回会被 $detached 守卫拦截
			const table = app.model.tables["channel"];
			const channel = table?.create();
			if (!channel) throw new Error("cannot create detached channel");
			Object.assign(channel, { platform, id, guildId, $detached: true });
			return channel;
		}
	}

	/**
	 * 内部工具：观察单个 channelId（不区分频道/群），
	 * 包装为可观察对象并在 diff 时写回数据库。
	 */
	async _observeChannelLike<K extends Channel.Field = never>(
		channelId: string,
		fields: Iterable<K> = [],
	) {
		const fieldSet = new Set<Channel.Field>(fields);
		const { platform } = this;
		const key = `${platform}:${channelId}`;

		const data = await this.getChannel(channelId, [...fieldSet]);
		const cache = observe(
			data,
			async (diff) => {
				// 游离频道不入库（写回前拦截），见上游 issue #1267：
				// https://github.com/koishijs/koishi/issues/1267
				if ("$detached" in data && data["$detached"]) return;
				await this.app.database.setChannel(platform, channelId, diff);
			},
			`channel ${key}`,
		);
		return cache;
	}

	/**
	 * 观察频道数据。
	 *
	 * 群聊场景下频道 ID 与群 ID 不同，需要同时观察两者：
	 * channel 挂 this.channel，guild 挂 this.guild（两者均含群级设置）。
	 */
	override async observeChannel<T extends Channel.Field = never>(
		fields: Iterable<T>,
	): Promise<Channel.Observed<T>> {
		const tasks = [this._observeChannelLike(this.channelId ?? "", fields)];
		if (this.channelId !== this.guildId) {
			tasks.push(this._observeChannelLike(this.guildId ?? "", fields));
		}
		const results = await Promise.all(tasks);
		const channel = results[0];
		if (!channel) throw new Error("failed to observe channel");
		const guild = results[1] ?? channel;
		this.guild = guild;
		this.channel = channel;
		return channel;
	}

	/**
	 * 查询用户记录。
	 *
	 * 不要字段时返回空对象（不查库）；记录不存在时：
	 * autoAuthorize > 0 则以该初始等级入库创建（继承会话语言 locales），
	 * 否则返回带 `$detached` 标记的游离对象。
	 */
	override async getUser<K extends User.Field = never>(
		userId = this.userId ?? "",
		fields: K[] = [],
	): Promise<User> {
		const { app, platform } = this;
		if (!fields.length) return {} as User;
		const user = await app.database.getUser(platform, userId, fields);
		if (user) return user as unknown as User;
		const authority = this.resolve(app.koishi.config.autoAuthorize ?? 1);
		const data = { locales: this.locales, authority, createdAt: new Date() };
		if (authority) {
			return app.database.createUser(platform, userId, data);
		} else {
			// 游离用户：仅存在于内存，写回会被 $detached 守卫拦截
			const table = app.model.tables["user"];
			const user = table?.create();
			if (!user) throw new Error("cannot create detached user");
			Object.assign(user, { ...data, $detached: true });
			return user;
		}
	}

	/**
	 * 观察用户数据。
	 *
	 * 已有缓存时只补查缺失字段并 `$merge` 合并；匿名消息不入库，
	 * 用内存临时对象充当（写回为空操作）。diff 写回同样带 $detached 守卫。
	 */
	override async observeUser<T extends User.Field = never>(
		fields: Iterable<T>,
	): Promise<User.Observed<T>> {
		const fieldSet = new Set<User.Field>(fields);
		const { userId } = this;

		// 缓存命中：剔除已有字段，若全都有则直接复用现有观察对象
		let cache = this.user;
		if (cache) {
			for (const key in cache) {
				// 非 user 字段的观察对象成员（$diff 等）不在集合内，delete 为空操作
				fieldSet.delete(key as User.Field);
			}
			if (!fieldSet.size) {
				return (this.user = cache) as User.Observed<T>;
			}
		}

		// 匿名用户：不落库，用模型默认值构造临时观察对象
		if ((this.author as { anonymous?: unknown } | undefined)?.anonymous) {
			const table = this.app.model.tables["user"];
			const fallback = table?.create();
			if (!fallback) throw new Error("cannot create anonymous user");
			fallback.authority = this.resolve(
				this.app.koishi.config.autoAuthorize ?? 1,
			);
			const user = observe(fallback, () => Promise.resolve());
			return (this.user = user);
		}

		const data = await this.getUser(userId, [...fieldSet]);
		cache = this.user;
		if (cache) {
			// 观察期间被并发创建过：合并本次查到的数据
			cache.$merge(data);
		} else {
			cache = observe(
				data,
				async (diff) => {
					// 游离用户不入库（写回前拦截），见上游 issue #1267：
					// https://github.com/koishijs/koishi/issues/1267
					if ("$detached" in data && data["$detached"]) return;
					await this.app.database.setUser(this.platform, userId ?? "", diff);
				},
				`user ${this.uid}`,
			);
		}
		return (this.user = cache) as User.Observed<T>;
	}
}
