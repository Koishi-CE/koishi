// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * dataview 插件（node 侧）：在控制台中查看和管理数据库内容。
 *
 * 以 `database` 数据服务向浏览器下发全库概览（各表的结构定义 + 统计信息），
 * 并注册 8 个 `database/*` RPC 事件，把前端的 get / set / create / remove /
 * upsert / eval / drop / stats 调用代理到本地数据库（参数与返回值经
 * serialize / deserialize 编解码，authority 4 权限门槛）。
 */

import { resolve } from "node:path";
import { DataService } from "@koishi-ce/console";
import {
	type Context,
	clone,
	type Dict,
	type Driver,
	Field,
	type Model,
	makeArray,
	omit,
	Schema,
} from "@koishi-ce/koishi";
import { deserialize, serialize } from "./utils.ts";

export * from "./utils.ts";

/** 可被前端经 `database/*` 事件代理调用的数据库方法名 */
export type Methods =
	| "get"
	| "set"
	| "eval"
	| "create"
	| "remove"
	| "upsert"
	| "drop"
	| "stats";

/** `database/*` RPC 事件：参数为序列化后的字符串，返回值为序列化后的字符串 */
export type DbEvents = {
	[M in Methods as `database/${M}`]: (
		...args: string[]
	) => Promise<string | undefined>;
};

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			database: DatabaseProvider;
		}
	}

	interface Events extends DbEvents {}
}

/** 单张表的展示信息：模型定义（剥离 ctx）+ 统计信息 */
export interface TableInfo extends Driver.TableStats, Model.Config {
	fields: Field.Config;
	primary: string[];
	/**
	 * 主键包装类型的构造器（如 Mongo 的 ObjectId）。
	 * 仅当首行数据的主键是包装类型时存在，set / remove 的主键值须先经其包装。
	 */
	HookObjectId?: new (
		value: unknown,
	) => object;
}

/** 全库概览：总体统计 + 按表名排序的各表信息 */
export interface DatabaseInfo extends Driver.Stats {
	tables: Dict<TableInfo>;
}

class DatabaseProvider extends DataService<DatabaseInfo> {
	static override inject = ["console", "database"];

	// 原本位于 namespace 的 export const Config;erasableSyntaxOnly 禁止携带
	// 运行时值的 namespace,迁为类静态成员(loader 从插件类上读取静态 Config)
	static Config: Schema<DatabaseProvider.Config> = Schema.object({});

	/** 全库概览的计算任务缓存（get(forced) 时清除重算） */
	task?: Promise<DatabaseInfo>;

	/**
	 * 注册一个 `database/*` RPC 事件，把调用代理到本地数据库同名方法。
	 *
	 * @param name 数据库方法名
	 * @param refresh 调用完成后是否刷新全库概览
	 */
	addListener(name: Methods, refresh = false) {
		this.ctx.console.addListener(
			`database/${name}`,
			async (...args: string[]) => {
				const callargs = args.map(deserialize);
				if (name === "set" || name === "remove") {
					// Mongo 等驱动的主键是包装类型，查询条件须先经其构造器包装
					const table = (await this.get()).tables[callargs[0] as string];
					if (table?.HookObjectId) {
						const row = callargs[1] as Record<string, unknown>;
						const key = table.primary[0] as string;
						row[key] = new table.HookObjectId(row[key]);
					}
				}
				// 各方法形参各异且经反序列化后类型不可知，统一按动态调用处理
				const method = this.ctx.database[name] as unknown as (
					...args: unknown[]
				) => Promise<unknown>;
				const result = await method(...callargs);
				if (refresh) void this.refresh();
				return result === undefined ? undefined : serialize(result);
			},
			{ authority: 4 },
		);
	}

	constructor(ctx: Context) {
		super(ctx, "database", { authority: 4 });

		ctx.console.addEntry(
			process.env["KOISHI_BASE"]
				? [
						`${process.env["KOISHI_BASE"]}/dist/index.js`,
						`${process.env["KOISHI_BASE"]}/dist/style.css`,
					]
				: process.env["KOISHI_ENV"] === "browser"
					? [import.meta.url.replace(/\/src\/[^/]+$/, "/client/index.ts")]
					: {
							dev: resolve(__dirname, "../client/index.ts"),
							prod: resolve(__dirname, "../dist"),
						},
		);

		this.addListener("create", true);
		this.addListener("eval", true);
		this.addListener("get");
		this.addListener("remove", true);
		this.addListener("set");
		this.addListener("stats", true);
		this.addListener("upsert", true);

		// 模型结构变化（建表 / 扩展字段等）时节流刷新全库概览
		const refresh = ctx.throttle(() => this.refresh(), 500);
		ctx.on("model", () => refresh());
	}

	async getInfo(): Promise<DatabaseInfo> {
		const stats = await this.ctx.database.stats();
		const result = { ...stats, tables: {} } as DatabaseInfo;
		await Promise.all(
			Object.entries(this.ctx.model.tables).map(async ([name, model]) => {
				// spread 会把可选属性以 undefined 形态带入（与 exactOptionalPropertyTypes
				// 相抵），此处以断言桥接；stats 无该表数据时补空对象
				const info = {
					...clone(omit(model, ["ctx"])),
					...(stats.tables[name] ?? {}),
				} as TableInfo;
				info.primary = makeArray(info.primary);
				for (const [key, field] of Object.entries(info.fields)) {
					if (!Field.available(field)) delete info.fields[key];
				}
				const primary = info.primary[0] as string;
				// 主键为 primary 类型且驱动是 Mongo 系时，探测主键包装构造器
				const driver = Object.values(this.ctx.database.drivers)[0];
				const isMongo =
					driver !== undefined &&
					["mongo", "MongoDriver"].includes(driver.constructor.name);
				if (isMongo && info.fields[primary]?.type.type === "primary") {
					const record = await this.ctx.database
						.select(name as never)
						.limit(1)
						.execute();
					const row = record[0] as Record<string, unknown> | undefined;
					const ctor = row?.[primary]?.constructor as new (
						value: unknown,
					) => object;
					if (ctor) info.HookObjectId = ctor;
				}
				result.tables[name] = info;
			}),
		);
		result.tables = Object.fromEntries(
			Object.entries(result.tables).sort(([a], [b]) => a.localeCompare(b)),
		);
		return result;
	}

	override get(forced = false) {
		if (forced) delete this.task;
		return (this.task ??= this.getInfo());
	}
}

namespace DatabaseProvider {
	// biome-ignore lint/suspicious/noEmptyInterface: 与上游保持一致,声明可被下游扩展的空配置
	export interface Config {}
}

export default DatabaseProvider;
