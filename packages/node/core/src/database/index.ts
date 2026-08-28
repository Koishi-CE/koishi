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
		[minato.Types]: Types;
		[minato.Tables]: Tables;
		[Context.Database]: Context.Database<this>;
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
		interface Database<C extends Context = Context> {
			getUser<K extends FlatKeys<User>>(
				platform: string,
				pid: string,
				modifier?: Driver.Cursor<K>,
			): Promise<FlatPick<User, K>>;
			setUser(platform: string, pid: string, data: Update<User>): Promise<void>;
			createUser(
				platform: string,
				pid: string,
				data: Partial<User>,
			): Promise<User>;
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
			getAssignedChannels<K extends Channel.Field>(
				fields?: K[],
				selfIdMap?: Dict<string[]>,
			): Promise<Pick<Channel, K>[]>;
			setChannel(
				platform: string,
				id: string,
				data: Update<Channel>,
			): Promise<void>;
			createChannel(
				platform: string,
				id: string,
				data: Partial<Channel>,
			): Promise<Channel>;
		}
	}
}

interface KoishiDatabase extends minato.Database<Tables, Types, Context> {}

class KoishiDatabase {
	ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
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

		ctx.mixin("database", ["broadcast"] as never[]);

		registerModels(ctx);

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

	async setUser(platform: string, pid: string, data: Update<User>) {
		const [binding] = await this.get("binding", { platform, pid }, ["aid"]);
		if (!binding) throw new Error("user not found");
		return this.set("user", binding.aid, data);
	}

	async createUser(platform: string, pid: string, data: Partial<User>) {
		const user = await this.create("user", data);
		await this.create("binding", { aid: user.id, bid: user.id, pid, platform });
		return user;
	}

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

	getSelfIds(platforms?: string[]): Dict<string[]> {
		const selfIdMap: Dict<string[]> = Object.create(null);
		for (const bot of this.ctx.bots) {
			if (!bot.platform || !bot.selfId) continue;
			if (platforms && !platforms.includes(bot.platform)) continue;
			(selfIdMap[bot.platform] ||= []).push(bot.selfId);
		}
		return selfIdMap;
	}

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

	setChannel(platform: string, id: string, data: Update<Channel>) {
		return this.set("channel", { platform, id }, data);
	}

	createChannel(platform: string, id: string, data: Partial<Channel>) {
		return this.create("channel", { platform, id, ...data });
	}

	broadcast(
		...args: [Fragment, boolean?] | [readonly string[], Fragment, boolean?]
	) {
		return broadcastDatabase(this, ...args);
	}
}

export default KoishiDatabase;
