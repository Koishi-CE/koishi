// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * SQLite 驱动核心路径测试（bun:test）。
 *
 * 覆盖：建表与自动迁移（legacy 列改名 / 新增列）、增删改查、
 * 类型 define 往返（date/binary/list/json/boolean/bigint）、
 * regexp 系自定义函数的查询算子、索引、事务回滚、stats、
 * 文件库持久化与目录自动创建，以及与 memory 驱动的行为对拍。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "@koishi-ce/koishi";
import * as memoryModule from "@koishijs/plugin-database-memory";
import { SQLiteDriver } from "./index.ts";

// 临时测试表注册进全局 Tables（动态表名的强类型通道）
declare module "@koishi-ce/koishi" {
	interface Tables {
		test_upsert: { id: number; key: string; value: number };
		test_types: {
			id: number;
			flag: boolean;
			when: Date;
			buf: ArrayBuffer;
			tags: string[];
			meta: { x: number; y: string };
			big: bigint;
		};
		test_regexp: { id: number; text: string };
		test_indexes: { id: number; name: string };
		test_tx: { id: number; v: string };
		test_alter: { id: number; v: string; extra: number };
		test_stats: { id: number; v: string };
		test_parity: {
			id: number;
			pid: string;
			authority: number;
		};
		test_file: {
			id: number;
			name?: string;
			name_old?: string;
		};
	}
}

// CJS 实现配 ESM 声明，Bun 互操作视图多包一层 default，穿透取真实驱动
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

const app = new App();
app.plugin(SQLiteDriver, { path: ":memory:" });

/** 测试内窥驱动实例的手法（minato Database 的 drivers 不在公开类型上） */
type TestDriver = {
	getIndexes(
		table: string,
	): Promise<
		{
			name: string;
			unique: boolean;
			keys: Record<string, string>;
		}[]
	>;
	createIndex(
		table: string,
		index: {
			name?: string;
			keys: Record<string, string>;
			unique?: boolean;
		},
	): Promise<void>;
	dropIndex(table: string, name: string): Promise<void>;
	withTransaction(
		callback: () => Promise<void>,
	): Promise<void>;
	stats(): Promise<{
		size: number;
		tables: Record<
			string,
			{ count?: number; size?: number }
		>;
	}>;
};

function getDriver(): TestDriver {
	const drivers = (
		app.database as unknown as { drivers: TestDriver[] }
	).drivers;
	return drivers[0]!;
}

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("SQLite CRUD", () => {
	it("user 表 create/get/set/remove 全链路", async () => {
		await app.database.createUser("mock", "u1", {
			authority: 1,
		});
		const user = await app.database.getUser("mock", "u1");
		expect(user?.authority).toBe(1);

		await app.database.setUser("mock", "u1", {
			authority: 3,
		});
		await expect(
			app.database.getUser("mock", "u1"),
		).resolves.toMatchObject({
			authority: 3,
		});

		await app.database.remove("user", { id: user!.id });
		await expect(
			app.database.getUser("mock", "u1"),
		).resolves.toBeUndefined();
	});

	it("upsert 语义：不存在则插入、存在则更新", async () => {
		app.model.extend(
			"test_upsert",
			{ id: "unsigned", key: "string", value: "integer" },
			{ primary: "id", autoInc: true },
		);
		// 第一轮：全部插入
		await app.database.upsert(
			"test_upsert",
			[
				{ key: "k1", value: 1 },
				{ key: "k2", value: 2 },
			],
			["key"],
		);
		expect(
			await app.database.get("test_upsert", {}),
		).toHaveLength(2);

		// 第二轮 upsert 命中已有行，走 UPDATE 分支
		await app.database.upsert(
			"test_upsert",
			[{ key: "k1", value: 7 }],
			["key"],
		);
		const [row] = await app.database.get("test_upsert", {
			key: "k1",
		});
		expect(row?.value).toBe(7);
		expect(
			await app.database.get("test_upsert", {}),
		).toHaveLength(2);
	});
});

describe("SQLite 类型往返", () => {
	it("date/binary/list/json/boolean/bigint 的 dump/load 往返", async () => {
		app.model.extend(
			"test_types",
			{
				id: "unsigned",
				flag: "boolean",
				when: "timestamp",
				buf: "binary",
				tags: "list",
				meta: "json",
				big: "bigint",
			},
			{ primary: "id", autoInc: true },
		);
		const date = new Date("2026-09-03T12:00:00Z");
		const buf = new Uint8Array([1, 2, 3, 255]);
		const row = await app.database.create("test_types", {
			flag: true,
			when: date,
			// binary 字段的模型类型是 ArrayBuffer（minato Type 映射），
			// 驱动 dump 层接受任意 ArrayBufferLike
			buf: buf.buffer as ArrayBuffer,
			tags: ["a", "b"],
			meta: { x: 1, y: "z" },
			big: 123n,
		});
		expect(row.id).toBe(1);
		await app.database.create("test_types", {
			flag: false,
		});

		const [got] = await app.database.get("test_types", {
			id: row.id,
		});
		expect(got!.flag).toBe(true);
		expect(got!.when instanceof Date).toBe(true);
		expect(+got!.when!).toBe(+date);
		expect(new Uint8Array(got!.buf!)).toEqual(buf);
		expect(got!.tags).toEqual(["a", "b"]);
		expect(got!.meta).toEqual({ x: 1, y: "z" });
		expect(typeof got!.big).toBe("bigint");
		expect(got!.big).toBe(123n);

		// boolean 查询走 define 的 +value dump 通道
		const falsy = await app.database.get("test_types", {
			flag: false,
		});
		expect(falsy).toHaveLength(1);

		// list 元素查询（$el / LIKE 通道）
		const tagged = await app.database.get("test_types", {
			tags: { $el: "a" },
		});
		expect(tagged).toHaveLength(1);
	});
});

describe("SQLite regexp 算子", () => {
	it("$regex 字符串模式与 RegExpLike flags", async () => {
		app.model.extend(
			"test_regexp",
			{ id: "unsigned", text: "string" },
			{ primary: "id", autoInc: true },
		);
		await app.database.create("test_regexp", {
			text: "hello",
		});
		await app.database.create("test_regexp", {
			text: "World",
		});

		const matched = await app.database.get("test_regexp", {
			text: { $regex: "h.llo" },
		});
		expect(matched).toHaveLength(1);

		// flags 含 i 走 regexp2 三参通道
		const ci = await app.database.get("test_regexp", {
			text: { $regex: { source: "W.rld", flags: "i" } },
		});
		expect(ci).toHaveLength(1);

		// 大小写敏感不匹配
		const cs = await app.database.get("test_regexp", {
			text: { $regex: "w.rld" },
		});
		expect(cs).toHaveLength(0);
	});
});

describe("SQLite 索引", () => {
	it("createIndex/getIndexes/dropIndex", async () => {
		app.model.extend(
			"test_indexes",
			{ id: "unsigned", name: "string" },
			{ primary: "id", autoInc: true },
		);
		// 触发一次建表（model.extend 的 prepare 是惰性的，driver 直调不经过
		// database 层的 prepared 队列）
		await app.database.create("test_indexes", {
			name: "n0",
		});
		const driver = getDriver();
		await driver.createIndex("test_indexes", {
			name: "idx_name",
			keys: { name: "asc" },
		});
		let indexes = await driver.getIndexes("test_indexes");
		const created = indexes.find(
			(i) => i.name === "idx_name",
		);
		expect(created).toBeDefined();
		expect(created!.keys["name"]).toBe("asc");

		await driver.dropIndex("test_indexes", "idx_name");
		indexes = await driver.getIndexes("test_indexes");
		expect(
			indexes.find((i) => i.name === "idx_name"),
		).toBeUndefined();
	});
});

describe("SQLite 事务", () => {
	it("withTransaction 提交与回滚", async () => {
		app.model.extend(
			"test_tx",
			{ id: "unsigned", v: "string" },
			{ primary: "id", autoInc: true },
		);
		// 先在事务外触发建表，避免 ROLLBACK 连 CREATE 一起回滚
		const seeded = await app.database.create("test_tx", {
			v: "seed",
		});
		await app.database.remove("test_tx", { id: seeded.id });

		await app.database.withTransaction(async () => {
			await app.database.create("test_tx", { v: "kept" });
		});
		await expect(
			app.database.get("test_tx", {}),
		).resolves.toHaveLength(1);

		// minato 3.7 的 transact 会吞业务错误（memory 驱动行为一致），
		// driver 层保证 ROLLBACK 生效——这里直测 driver 层的 rejects 与回滚效果
		await expect(
			getDriver().withTransaction(async () => {
				await app.database.create("test_tx", {
					v: "rolled",
				});
				throw new Error("rollback me");
			}),
		).rejects.toThrow("rollback me");
		const rows = await app.database.get("test_tx", {});
		expect(rows).toHaveLength(1);
		expect(rows[0]!.v).toBe("kept");
	});
});

describe("SQLite 表结构迁移", () => {
	it("同实例新增列走 ALTER 且旧行保留", async () => {
		app.model.extend(
			"test_alter",
			{ id: "unsigned", v: "string" },
			{ primary: "id", autoInc: true },
		);
		await app.database.create("test_alter", { v: "old" });

		// 二次 extend 追加全新列：走 ALTER TABLE ADD，不动旧行
		app.model.extend(
			"test_alter",
			{ id: "unsigned", v: "string", extra: "integer" },
			{ primary: "id", autoInc: true },
		);
		await app.database.set("test_alter", {}, { extra: 42 });
		const [row] = await app.database.get("test_alter", {});
		expect(row?.v).toBe("old");
		expect(row?.extra).toBe(42);
	});
});

describe("SQLite stats", () => {
	it("driver.stats() 汇总库与表规模", async () => {
		app.model.extend(
			"test_stats",
			{ id: "unsigned", v: "string" },
			{ primary: "id", autoInc: true },
		);
		await app.database.create("test_stats", { v: "x" });
		const stats = await getDriver().stats();
		expect(stats.size).toBeGreaterThan(0);
		expect(stats.tables["test_stats"]?.count).toBe(1);
	});
});

describe("SQLite 文件库", () => {
	const dir = join(
		tmpdir(),
		`koishi-ce-sqlite-test-${Date.now()}`,
	);
	const path = join(dir, "nested", "test.db");

	// 文件库双实例：同时覆盖目录自动创建、持久化与跨版本的
	// legacy 列改名迁移（v1 建表写数据 → v2 以 legacy 声明重开）
	it("目录自动创建、持久化与 legacy 列改名迁移", async () => {
		// v1：嵌套目录自动创建，列名 name_old
		const app1 = new App();
		app1.plugin(SQLiteDriver, { path });
		await app1.start();
		app1.model.extend(
			"test_file",
			{ id: "unsigned", name_old: "string" },
			{ primary: "id", autoInc: true },
		);
		await app1.database.create("test_file", {
			name_old: "alice",
		});
		await app1.stop();

		// v2：同一路径重开，name 以 legacy 归并旧列，数据保留
		const app2 = new App();
		app2.plugin(SQLiteDriver, { path });
		await app2.start();
		app2.model.extend(
			"test_file",
			{
				id: "unsigned",
				name: { type: "string", legacy: ["name_old"] },
			},
			{ primary: "id", autoInc: true },
		);
		const [row] = await app2.database.get("test_file", {});
		expect(row?.name).toBe("alice");
		await app2.stop();
	});

	afterAll(async () => {
		// win32 下 close 后文件锁释放有延迟，手动循环重试清理
		for (let i = 0; i < 10; i++) {
			try {
				await rm(dir, { recursive: true, force: true });
				return;
			} catch {
				await new Promise((resolve) =>
					setTimeout(resolve, 100),
				);
			}
		}
	});
});

describe("与 memory 驱动行为对拍", () => {
	const appMem = new App();
	appMem.plugin(memory);

	beforeAll(async () => {
		await appMem.start();
		// 双驱动各自声明同构的临时表（user 表的 platform/pid 已拆到
		// binding 表，领域字段不方便直接 create，对拍用独立表）
		for (const target of [app, appMem]) {
			target.model.extend(
				"test_parity",
				{
					id: "unsigned",
					pid: "string",
					authority: "integer",
				},
				{ primary: "id", autoInc: true },
			);
		}
	});
	afterAll(() => appMem.stop());

	it("同一批查询语句两驱动结果一致", async () => {
		for (const target of [app.database, appMem.database]) {
			await target.create("test_parity", {
				pid: "parity",
				authority: 2,
			});
			await target.create("test_parity", {
				pid: "parity2",
				authority: 4,
			});
		}

		const query = { pid: { $regex: /^parity/ } };
		const [sqliteRows, memoryRows] = await Promise.all([
			app.database.get("test_parity", query),
			appMem.database.get("test_parity", query),
		]);
		expect(sqliteRows.map((r) => r.pid).sort()).toEqual(
			memoryRows.map((r) => r.pid).sort(),
		);

		// 数值比较算子
		const filter = {
			pid: { $regex: /^parity/ },
			authority: { $gte: 3 },
		};
		const [s2, m2] = await Promise.all([
			app.database.get("test_parity", filter),
			appMem.database.get("test_parity", filter),
		]);
		expect(s2.map((r) => r.pid)).toEqual(
			m2.map((r) => r.pid),
		);
		expect(s2).toHaveLength(1);
	});
});
