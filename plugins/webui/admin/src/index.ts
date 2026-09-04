// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { resolve } from "node:path";
import type { Entry } from "@koishi-ce/console";
import {
	$,
	type Context,
	type Dict,
	remove,
	Schema,
	Service,
} from "@koishi-ce/koishi";
import zhCN from "../locales/zh-CN.yml";
import command from "./command.ts";

export * from "./command.ts";

/**
 * @koishi-ce/plugin-admin 的 node 侧入口。
 *
 * 提供权限管理服务 {@link Admin}：基于数据库表维护「用户组（group）」与
 * 「用户组路线（perm_track）」两类权限容器，把它们的权限定义注入
 * ctx.permissions 继承体系；同时注册 console 前端入口与一组管理 RPC 事件。
 * 聊天侧指令（user / channel 系列）见 ./command.ts。
 */

declare module "@koishi-ce/koishi" {
	interface Context {
		admin: Admin;
	}

	interface Tables {
		group: PermGroup;
		perm_track: PermTrack;
	}
}

declare module "@koishi-ce/console" {
	interface Events {
		"admin/create-track"(name: string): Promise<number>;
		"admin/rename-track"(
			id: number,
			name: string,
		): Promise<void>;
		"admin/delete-track"(id: number): Promise<void>;
		"admin/update-track"(
			id: number,
			permissions: string[],
		): Promise<void>;
		"admin/create-group"(name: string): Promise<number>;
		"admin/rename-group"(
			id: number,
			name: string,
		): Promise<void>;
		"admin/delete-group"(id: number): Promise<void>;
		"admin/update-group"(
			id: number,
			permissions: string[],
		): Promise<void>;
		"admin/add-user"(
			gid: number,
			platform: string,
			aid: string,
		): Promise<void>;
		"admin/remove-user"(
			gid: number,
			platform: string,
			aid: string,
		): Promise<void>;
	}
}

/** 用户组数据（group 表）：权限的命名集合，用户通过 `group:<id>` 权限加入。 */
export interface PermGroup {
	id: number;
	name: string;
	permissions: string[];
	/** 组内用户数（仅在内存中统计，不落库） */
	count?: number;
	/** 注销权限定义的回调 */
	dispose?: () => void;
}

/** 用户组路线数据（perm_track 表）：按列表顺序形成权限的继承链。 */
export interface PermTrack {
	id: number;
	name: string;
	permissions: string[];
	/** 注销权限定义的回调 */
	dispose?: () => void;
}

/**
 * 权限管理服务：维护用户组与用户组路线的内存态与数据库态，
 * 并把它们注册为 ctx.permissions 中的继承规则；
 * 每个变更方法都会同步数据库并刷新 console 数据入口。
 */
export class Admin extends Service {
	// erasableSyntaxOnly:原 namespace Admin 中的运行时值迁至类静态成员
	static inject = ["database"];

	static Config: Schema<Admin.Config> = Schema.object({});

	groups!: PermGroup[];
	tracks!: PermTrack[];
	entry?: Entry<Admin.Data> | undefined;

	// erasableSyntaxOnly:参数属性改为显式字段;覆盖 Service 基类的 config
	override config: Admin.Config;

	constructor(ctx: Context, config: Admin.Config) {
		super(ctx, "admin");
		this.config = config;

		ctx.i18n.define("zh-CN", zhCN);
		ctx.plugin(command);

		ctx.model.extend(
			"group",
			{
				id: "unsigned",
				name: "string",
				permissions: "list",
			},
			{ autoInc: true },
		);

		ctx.model.extend(
			"perm_track",
			{
				id: "unsigned",
				name: "string",
				permissions: "list",
			},
			{ autoInc: true },
		);
	}

	/**
	 * 服务启动：从数据库加载用户组与路线、统计各组人数并注册权限定义，
	 * 随后注入 console 上下文注册前端入口与 RPC 监听（均要求 authority 4）。
	 */
	override async start() {
		this.groups = await this.ctx.database.get("group", {});
		this.tracks = await this.ctx.database.get(
			"perm_track",
			{},
		);
		for (const item of this.groups) {
			item.count =
				(await this.ctx.database
					.select("user", {
						permissions: { ["$el"]: `group:${item.id}` },
					})
					.execute((row) => $.count(row.id))) || 0;
			this.setupGroup(item);
		}
		for (const item of this.tracks) {
			this.setupTrack(item);
		}

		this.ctx.inject(["console"], (ctx) => {
			ctx.on("dispose", () => (this.entry = undefined));

			this.entry = ctx.console.addEntry(
				process.env["KOISHI_BASE"]
					? [
							`${process.env["KOISHI_BASE"]}/dist/index.js`,
							`${process.env["KOISHI_BASE"]}/dist/style.css`,
						]
					: process.env["KOISHI_ENV"] === "browser"
						? [
								import.meta.url.replace(
									/\/src\/[^/]+$/,
									"/client/index.ts",
								),
							]
						: {
								dev: resolve(
									__dirname,
									"../client/index.ts",
								),
								prod: resolve(__dirname, "../dist"),
							},
				() => ({
					group: Object.fromEntries(
						this.groups.map((group) => [group.id, group]),
					),
					track: Object.fromEntries(
						this.tracks.map((track) => [track.id, track]),
					),
				}),
			);

			ctx.console.addListener(
				"admin/create-track",
				(name) => {
					return this.createTrack(name);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/rename-track",
				(id, name) => {
					return this.renameTrack(id, name);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/delete-track",
				(id) => {
					return this.deleteTrack(id);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/update-track",
				(id, permissions) => {
					return this.updateTrack(id, permissions);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/create-group",
				(name) => {
					return this.createGroup(name);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/rename-group",
				(id, name) => {
					return this.renameGroup(id, name);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/delete-group",
				(id) => {
					return this.deleteGroup(id);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/update-group",
				(id, permissions) => {
					return this.updateGroup(id, permissions);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/add-user",
				(gid, platform, aid) => {
					return this.addUser(gid, platform, aid);
				},
				{ authority: 4 },
			);

			ctx.console.addListener(
				"admin/remove-user",
				(gid, platform, aid) => {
					return this.removeUser(gid, platform, aid);
				},
				{ authority: 4 },
			);
		});
	}

	/**
	 * 注册用户组的权限定义：组内声明的每个权限，
	 * 只要用户持有 `group:<id>` 就视为继承获得。
	 */
	private setupGroup(item: PermGroup) {
		item.dispose = this.ctx.permissions.define("(name)", {
			inherits: ({ name }) => {
				if (item.permissions.includes(name))
					return [`group:${item.id}`];
				return undefined;
			},
		});
	}

	/**
	 * 注册用户组路线的权限定义：权限按列表顺序构成继承链，
	 * 持有列表中某个权限即同时继承其前面的所有权限。
	 */
	private setupTrack(item: PermTrack) {
		item.dispose = this.ctx.permissions.define("(name)", {
			inherits: ({ name }) => {
				const index = item.permissions.indexOf(name);
				const prev =
					index > 0
						? item.permissions[index - 1]
						: undefined;
				return prev !== undefined ? [prev] : undefined;
			},
		});
	}

	/** 创建用户组路线，返回新 id。 */
	async createTrack(name: string) {
		const item = await this.ctx.database.create(
			"perm_track",
			{ name },
		);
		this.setupTrack(item);
		this.tracks.push(item);
		this.entry?.refresh();
		return item.id;
	}

	/** 重命名用户组路线（名称未变化时直接跳过）。 */
	async renameTrack(id: number, name: string) {
		const item = this.tracks.find(
			(track) => track.id === id,
		);
		if (!item) throw new Error("track not found");
		if (item.name === name) return;
		item.name = name;
		await this.ctx.database.set("perm_track", id, { name });
		this.entry?.refresh();
	}

	/** 删除用户组路线：先注销权限定义，再删除数据库记录。 */
	async deleteTrack(id: number) {
		const index = this.tracks.findIndex(
			(track) => track.id === id,
		);
		if (index < 0) throw new Error("track not found");
		const [item] = this.tracks.splice(index, 1);
		if (!item) throw new Error("track not found");
		item.dispose?.();
		this.entry?.refresh();
		await this.ctx.database.remove("perm_track", id);
	}

	/** 整体替换某条路线的权限列表。 */
	async updateTrack(id: number, permissions: string[]) {
		const item = this.tracks.find(
			(group) => group.id === id,
		);
		if (!item) throw new Error("track not found");
		item.permissions = permissions;
		await this.ctx.database.set("perm_track", id, {
			permissions,
		});
		this.entry?.refresh();
	}

	/** 创建用户组（人数从 0 起计），返回新 id。 */
	async createGroup(name: string) {
		const item = await this.ctx.database.create("group", {
			name,
		});
		item.count = 0;
		this.setupGroup(item);
		this.groups.push(item);
		this.entry?.refresh();
		return item.id;
	}

	/** 重命名用户组（名称未变化时直接跳过）。 */
	async renameGroup(id: number, name: string) {
		const item = this.groups.find(
			(group) => group.id === id,
		);
		if (!item) throw new Error("group not found");
		if (item.name === name) return;
		item.name = name;
		await this.ctx.database.set("group", id, { name });
		this.entry?.refresh();
	}

	/**
	 * 删除用户组：注销权限定义后，从所有成员用户的 permissions 中
	 * 移除 `group:<id>`（upsert 批量回写），再清理其它组对它的引用，
	 * 最后删除组本身。任何一步都保持数据库与内存一致。
	 */
	async deleteGroup(id: number) {
		const index = this.groups.findIndex(
			(group) => group.id === id,
		);
		if (index < 0) throw new Error("group not found");
		const [item] = this.groups.splice(index, 1);
		if (!item) throw new Error("group not found");
		item.dispose?.();
		// 找出所有 permissions 含 group:<id> 的成员用户，逐个移除该引用后批量回写
		const users = await this.ctx.database.get(
			"user",
			{ permissions: { ["$el"]: `group:${id}` } },
			["id", "permissions"],
		);
		for (const user of users) {
			remove(user.permissions, `group:${id}`);
		}
		await this.ctx.database.upsert("user", users);
		// 其它用户组若把本组当作权限引用，同样清理掉
		const updates = this.groups.filter((group) => {
			return remove(group.permissions, `group:${id}`);
		});
		await this.ctx.database.upsert("group", updates);
		await this.ctx.database.remove("group", id);
		this.entry?.refresh();
	}

	/** 整体替换某个用户组的权限列表。 */
	async updateGroup(id: number, permissions: string[]) {
		const item = this.groups.find(
			(group) => group.id === id,
		);
		if (!item) throw new Error("group not found");
		item.permissions = permissions;
		await this.ctx.database.set("group", id, {
			permissions,
		});
		this.entry?.refresh();
	}

	/**
	 * 把用户加入用户组：向其 permissions 追加 `group:<gid>` 并回写，
	 * 已在组内时不重复写入。
	 * @param id 用户组 id
	 * @param platform 用户所属平台
	 * @param aid 平台内的用户号
	 */
	async addUser(id: number, platform: string, aid: string) {
		const item = this.groups.find(
			(group) => group.id === id,
		);
		if (!item) throw new Error("group not found");
		const data = await this.ctx.database.getUser(
			platform,
			aid,
			["id", "permissions"],
		);
		if (!data) throw new Error("user not found");
		if (!data.permissions.includes(`group:${item.id}`)) {
			data.permissions.push(`group:${item.id}`);
			item.count = (item.count ?? 0) + 1;
			await this.ctx.database.set("user", data.id, {
				permissions: data.permissions,
			});
			this.entry?.refresh();
		}
	}

	/**
	 * 把用户移出用户组：从其 permissions 中摘除 `group:<gid>` 并回写，
	 * 本就不在组内时不做任何写入。
	 */
	async removeUser(
		id: number,
		platform: string,
		aid: string,
	) {
		const item = this.groups.find(
			(group) => group.id === id,
		);
		if (!item) throw new Error("group not found");
		const data = await this.ctx.database.getUser(
			platform,
			aid,
			["id", "permissions"],
		);
		if (!data) throw new Error("user not found");
		if (remove(data.permissions, `group:${item.id}`)) {
			item.count = (item.count ?? 0) - 1;
			await this.ctx.database.set("user", data.id, {
				permissions: data.permissions,
			});
			this.entry?.refresh();
		}
	}
}

// erasableSyntaxOnly:仅保留纯类型 namespace,运行时值(inject / Config Schema)已迁至 Admin 类静态成员
export namespace Admin {
	export type Config = Record<never, never>;

	/** 下发给前端的数据形状：以 id 为键的用户组 / 路线字典。 */
	export interface Data {
		group: Dict<PermGroup>;
		track: Dict<PermTrack>;
	}
}

export default Admin;
