import { observe } from "@koishi-ce/utils";
import type { Channel, User } from "../database";
import { SessionMessaging } from "./messaging";
/** 会话数据装配层：频道与用户数据的获取、创建与观察缓存 */
export class SessionObservable extends SessionMessaging {
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
			const table = app.model.tables["channel"];
			const channel = table?.create();
			if (!channel) throw new Error("cannot create detached channel");
			Object.assign(channel, { platform, id, guildId, $detached: true });
			return channel;
		}
	}

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
				// https://github.com/koishijs/koishi/issues/1267
				if ("$detached" in data && data["$detached"]) return;
				await this.app.database.setChannel(platform, channelId, diff as any);
			},
			`channel ${key}`,
		);
		return cache;
	}

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
			const table = app.model.tables["user"];
			const user = table?.create();
			if (!user) throw new Error("cannot create detached user");
			Object.assign(user, { ...data, $detached: true });
			return user;
		}
	}

	override async observeUser<T extends User.Field = never>(
		fields: Iterable<T>,
	): Promise<User.Observed<T>> {
		const fieldSet = new Set<User.Field>(fields);
		const { userId } = this;

		let cache = this.user;
		if (cache) {
			for (const key in cache) {
				fieldSet.delete(key as any);
			}
			if (!fieldSet.size) return (this.user = cache as any);
		}

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
			cache.$merge(data);
		} else {
			cache = observe(
				data,
				async (diff) => {
					// https://github.com/koishijs/koishi/issues/1267
					if ("$detached" in data && data["$detached"]) return;
					await this.app.database.setUser(
						this.platform,
						userId ?? "",
						diff as any,
					);
				},
				`user ${this.uid}`,
			);
		}
		return (this.user = cache as any);
	}
}
