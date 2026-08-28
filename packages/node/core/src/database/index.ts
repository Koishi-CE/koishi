/**
 * 数据库模块——在 minato ORM 之上提供 Koishi 的数据访问层。
 *
 * minato 的 `Database` 提供通用 CRUD（get / set / create / upsert 等），
 * 本文件定义 `KoishiDatabase`，针对 Koishi 的三张核心表补充分层封装：
 * - `user` / `channel`：主数据表（用户与频道）；
 * - `binding`：平台账号与内部用户 id 的绑定表（一个用户可绑定多平台）。
 *
 * 用户相关方法先查 binding 换取内部 aid 再操作 user 表；
 * 频道相关方法直接以 (platform, id) 定位。此外还提供
 * 全服广播入口 broadcast（委托 broadcast.ts）与数据模型注册（models.ts）。
 */
import type { Fragment } from "@satorijs/core";
import type { Dict, MaybeArray } from "cosmokit";
import type { Driver, FlatKeys, FlatPick, Update } from "minato";
import * as minato from "minato";
import { Context } from "../context";
import { broadcastDatabase } from "./broadcast";
import { registerModels } from "./models";
import type { Channel, Tables, Types, User } from "./tables";

export * from "./tables";

declare module "../context" {
	interface Context {
		/** 向 minato 注册的运行时类型映射 */
		[minato.Types]: Types;
		/** 向 minato 注册的表结构定义 */
		[minato.Tables]: Tables;
		/** 数据库服务（minato Database + 本模块扩展的快捷方法） */
		[Context.Database]: Context.Database<this>;
		/**
		 * 向所有受理频道广播消息（不指定频道列表时广播全部）。
		 *
		 * @param forced 为 false 时跳过 mute / flag 标记的频道
		 */
		broadcast(content: Fragment, forced?: boolean): Promise<string[]>;
		broadcast(
			channels: readonly string[],
			content: Fragment,
			forced?: boolean,
		): Promise<string[]>;
	}

	namespace Context {
		// https://github.com/typescript-eslint/typescript-eslint/issues/6720
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		/**
		 * Koishi 数据库服务的类型层：user / binding / channel 三表的
		 * 领域方法签名（实现见本文件 KoishiDatabase 类）。
		 */
		interface Database<C extends Context = Context> {
			/** 按 (platform, pid) 查用户（经 binding 表换算内部 id） */
			getUser<K extends FlatKeys<User>>(
				platform: string,
				pid: string,
				modifier?: Driver.Cursor<K>,
			): Promise<FlatPick<User, K>>;
			/** 按 (platform, pid) 更新用户；未绑定则抛错 */
			setUser(platform: string, pid: string, data: Update<User>): Promise<void>;
			/** 创建用户并同步建立平台绑定 */
			createUser(
				platform: string,
				pid: string,
				data: Partial<User>,
			): Promise<User>;
			/** 查询单个频道（找不到时仍返回带标识字段的空记录） */
			getChannel<K extends FlatKeys<Channel>>(
				platform: string,
				id: string,
				modifier?: Driver.Cursor<K>,
			): Promise<FlatPick<Channel, K | "id" | "platform">>;
			/** 批量查询频道 */
			getChannel<K extends FlatKeys<Channel>>(
				platform: string,
				ids: string[],
				modifier?: Driver.Cursor<K>,
			): Promise<FlatPick<Channel, K>[]>;
			/** 查询当前机器人受理的频道（用于广播） */
			getAssignedChannels<K extends Channel.Field>(
				fields?: K[],
				selfIdMap?: Dict<string[]>,
			): Promise<Pick<Channel, K>[]>;
			/** 按 (platform, id) 更新频道 */
			setChannel(
				platform: string,
				id: string,
				data: Update<Channel>,
			): Promise<void>;
			/** 创建频道 */
			createChannel(
				platform: string,
				id: string,
				data: Partial<Channel>,
			): Promise<Channel>;
		}
	}
}

interface KoishiDatabase extends minato.Database<Tables, Types, Context> {}

/**
 * Koishi 数据库实现：minato Database 之上叠加领域方法。
 * 通过 `ctx.mixin` 挂载为 `database.*` 服务方法。
 */
class KoishiDatabase {
	ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
		// 注册为 database 服务方法：插件内可直接 ctx.database.getUser(...) 调用
		ctx.mixin(this, {
			getUser: "database.getUser",
			setUser: "database.setUser",
			createUser: "database.createUser",
			getChannel: "database.getChannel",
			getAssignedChannels: "database.getAssignedChannels",
			setChannel: "database.setChannel",
			createChannel: "database.createChannel",
			broadcast: "database.broadcast",
		});

		// ctx.broadcast 是 database.broadcast 的快捷方式
		ctx.mixin("database", ["broadcast"] as never[]);

		registerModels(ctx);

		// 新平台接入时：为 user 表动态补充该平台字段，并把存量数据
		// 迁移到 binding 绑定表（老版本平台字段直接写在 user 表上）
		ctx.on("login-added", ({ platform }) => {
			const table = ctx.model.tables["user"];
			if (table && platform in table.fields) return;
			ctx.model.migrate("user", { [platform]: "string(255)" }, async (db) => {
				const users = await db.get("user", { [platform]: { $exists: true } }, [
					"id",
					platform as never,
				]);
				await db.upsert(
					"binding",
					users
						.filter((u) => (u as Record<string, unknown>)[platform])
						.map((user) => ({
							aid: user.id,
							bid: user.id,
							pid: (user as unknown as Record<string, string>)[platform] ?? "",
							platform,
						})),
				);
			});
		});
	}

	/**
	 * 按 (platform, pid) 查询用户。
	 * binding 表把平台账号映射到内部 aid，再按 aid 查 user 表；
	 * 未绑定时返回 undefined（不自动创建，创建走 createUser）。
	 */
	async getUser<K extends FlatKeys<User>>(
		platform: string,
		pid: string,
		modifier?: Driver.Cursor<K>,
	): Promise<FlatPick<User, K>> {
		const [binding] = await this.get("binding", { platform, pid }, ["aid"]);
		if (!binding) return undefined as never;
		const [user] = await this.get("user", { id: binding.aid }, modifier);
		return user as FlatPick<User, K>;
	}

	/** 按 (platform, pid) 更新用户；没有绑定记录则抛错。 */
	async setUser(platform: string, pid: string, data: Update<User>) {
		const [binding] = await this.get("binding", { platform, pid }, ["aid"]);
		if (!binding) throw new Error("user not found");
		return this.set("user", binding.aid, data);
	}

	/** 创建用户并同步建立初始平台绑定（aid = bid = user.id）。 */
	async createUser(platform: string, pid: string, data: Partial<User>) {
		const user = await this.create("user", data);
		await this.create("binding", { aid: user.id, bid: user.id, pid, platform });
		return user;
	}

	/**
	 * 查询频道（单个 / 批量重载）。
	 * 单个查询在记录不存在时仍补上 platform / id 标识字段返回，
	 * 便于调用方拿到的对象始终具备定位信息。
	 */
	getChannel<K extends FlatKeys<Channel>>(
		platform: string,
		id: string,
		modifier?: Driver.Cursor<K>,
	): Promise<FlatPick<Channel, K | "id" | "platform">>;
	getChannel<K extends FlatKeys<Channel>>(
		platform: string,
		ids: string[],
		modifier?: Driver.Cursor<K>,
	): Promise<FlatPick<Channel, K>[]>;
	async getChannel(platform: string, id: MaybeArray<string>, modifier?: any) {
		const data = await this.get("channel", { platform, id }, modifier);
		if (Array.isArray(id)) return data;
		if (data[0]) Object.assign(data[0], { platform, id });
		return data[0];
	}

	/**
	 * 汇总当前在线 bot 的 { platform -> selfId 列表 } 映射。
	 *
	 * @param platforms 限定只统计这些平台
	 */
	getSelfIds(platforms?: string[]): Dict<string[]> {
		const selfIdMap: Dict<string[]> = Object.create(null);
		for (const bot of this.ctx.bots) {
			if (!bot.platform || !bot.selfId) continue;
			if (platforms && !platforms.includes(bot.platform)) continue;
			(selfIdMap[bot.platform] ||= []).push(bot.selfId);
		}
		return selfIdMap;
	}

	/**
	 * 查询当前机器人受理（assignee 匹配某平台任一 selfId）的频道。
	 * 广播默认只覆盖受理频道，避免向未接管频道刷屏。
	 */
	getAssignedChannels<K extends Channel.Field>(
		fields?: K[],
		selfIdMap?: Dict<string[]>,
	): Promise<Pick<Channel, K>[]>;
	async getAssignedChannels(
		fields?: Channel.Field[],
		selfIdMap: Dict<string[]> = this.getSelfIds(),
	) {
		return this.get(
			"channel",
			{
				$or: Object.entries(selfIdMap).map(([platform, assignee]) => ({
					platform,
					assignee,
				})),
			},
			fields,
		);
	}

	/** 按 (platform, id) 更新频道。 */
	setChannel(platform: string, id: string, data: Update<Channel>) {
		return this.set("channel", { platform, id }, data);
	}

	/** 创建频道（platform / id 与其余数据合并写入）。 */
	createChannel(platform: string, id: string, data: Partial<Channel>) {
		return this.create("channel", { platform, id, ...data });
	}

	/** 全服广播（实现见 broadcast.ts 的 broadcastDatabase）。 */
	broadcast(
		...args: [Fragment, boolean?] | [readonly string[], Fragment, boolean?]
	) {
		return broadcastDatabase(this, ...args);
	}
}

export default KoishiDatabase;
