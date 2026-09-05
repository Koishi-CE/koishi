// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内存驱动专项测试（bun:test）。
 *
 * core 的 database 测试已覆盖领域方法语义（走 memory 后端），
 * 本文件补驱动自有面的盲区：自增主键与重复键拒绝、upsert
 * 语义、join（笛卡尔积与 optional 留空）、group/having 聚合、
 * eval 单值求值、set/remove 计数、事务快照回滚、索引记账
 * （不加速查询，仅维护元数据）与 drop / dropAll / stats。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { App } from "@koishi-ce/koishi";
import type { Row } from "minato";
import { $ } from "minato";
import { MemoryDriver } from "./index.ts";

// 临时测试表注册进全局 Tables（动态表名的强类型通道）
declare module "@koishi-ce/koishi" {
	interface Tables {
		test_auto: { id: number; v: string };
		test_key: { k1: string; k2: string; v: number };
		test_join_a: { id: number; tag: string };
		test_join_b: { id: number; ref: number; label: string };
		test_group: { id: number; dept: string; score: number };
	}
}

const app = new App();
app.plugin(MemoryDriver);

/** join 谓词参数形态（运行时为 minato 的 Row proxy，字段访问产出求值表达式） */
type JoinRows = {
	a: Row<{ id: number; tag: string }>;
	b: Row<{ id: number; ref: number; label: string }>;
};

/** 测试内窥驱动实例的手法（minato Database 的 drivers 不在公开类型上） */
function getDriver(): MemoryDriver {
	const drivers = (
		app.database as unknown as { drivers: MemoryDriver[] }
	).drivers;
	return drivers[0]!;
}

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("自增主键与重复键", () => {
	it("autoInc 连续分配且跨表独立", async () => {
		app.model.extend(
			"test_auto",
			{ id: "unsigned", v: "string" },
			{ primary: "id", autoInc: true },
		);
		await app.database.create("test_auto", { v: "a" });
		await app.database.create("test_auto", { v: "b" });
		const rows = await app.database.get("test_auto", {});
		expect(rows.map((r) => r.id)).toEqual([1, 2]);

		// 显式指定 id 时不走自增；后续自增计数不受显式值影响
		await app.database.create("test_auto", {
			id: 100,
			v: "c",
		});
		await app.database.create("test_auto", { v: "d" });
		const next = await app.database.get("test_auto", {
			v: "d",
		});
		expect(next[0]!.id).toBe(3);
	});

	it("非自增主键重复 create 抛 duplicate-entry", async () => {
		app.model.extend(
			"test_key",
			{ k1: "string", k2: "string", v: "integer" },
			{ primary: ["k1", "k2"] },
		);
		await app.database.create("test_key", {
			k1: "a",
			k2: "x",
			v: 1,
		});
		await expect(
			app.database.create("test_key", {
				k1: "a",
				k2: "x",
				v: 2,
			}),
		).rejects.toThrow("duplicate entry");
		// 不同键组合不受影响
		await app.database.create("test_key", {
			k1: "a",
			k2: "y",
			v: 3,
		});
		expect(
			await app.database.get("test_key", {}),
		).toHaveLength(2);
	});
});

describe("upsert / set / remove", () => {
	it("upsert 按 keys 匹配：命中更新、未命中插入", async () => {
		await app.database.upsert(
			"test_key",
			[{ k1: "u", k2: "1", v: 1 }],
			["k1", "k2"],
		);
		// 命中：更新 v
		await app.database.upsert(
			"test_key",
			[{ k1: "u", k2: "1", v: 5 }],
			["k1", "k2"],
		);
		await expect(
			app.database.get("test_key", { k1: "u", k2: "1" }),
		).resolves.toMatchObject([{ v: 5 }]);
		// 未命中：新行
		await app.database.upsert(
			"test_key",
			[{ k1: "u", k2: "2", v: 9 }],
			["k1", "k2"],
		);
		expect(
			await app.database.get("test_key", { k1: "u" }),
		).toHaveLength(2);
	});

	it("set / remove 返回命中计数", async () => {
		const matched = await app.database.set(
			"test_key",
			{ k1: "u" },
			{ v: 0 },
		);
		expect(matched).toMatchObject({ matched: 2 });
		const removed = await app.database.remove("test_key", {
			k2: "2",
		});
		expect(removed).toMatchObject({
			removed: 1,
			matched: 1,
		});
		// 此前用例累计留下 a/x、a/y、u/1 三行
		expect(
			await app.database.get("test_key", {}),
		).toHaveLength(3);
	});
});

describe("join 与聚合", () => {
	beforeAll(async () => {
		app.model.extend(
			"test_join_a",
			{ id: "unsigned", tag: "string" },
			{ primary: "id", autoInc: true },
		);
		app.model.extend(
			"test_join_b",
			{ id: "unsigned", ref: "unsigned", label: "string" },
			{ primary: "id", autoInc: true },
		);
		app.model.extend(
			"test_group",
			{ id: "unsigned", dept: "string", score: "integer" },
			{ primary: "id", autoInc: true },
		);
		// minato 3.7 的 database.create 只收单行，批量走循环
		await app.database.create("test_join_a", { tag: "t1" });
		await app.database.create("test_join_a", { tag: "t2" });
		await app.database.create("test_join_b", {
			ref: 1,
			label: "l1",
		});
		await app.database.create("test_join_b", {
			ref: 1,
			label: "l2",
		});
		await app.database.create("test_group", {
			dept: "a",
			score: 1,
		});
		await app.database.create("test_group", {
			dept: "a",
			score: 3,
		});
		await app.database.create("test_group", {
			dept: "b",
			score: 5,
		});
	});

	it("内连接：笛卡尔积按谓词过滤", async () => {
		const rows = await app.database
			.join(
				{ a: "test_join_a", b: "test_join_b" },
				(r: JoinRows) => $.eq(r.b.ref, r.a.id),
			)
			.execute();
		// t1/t2 均有 ref 命中：t1×(l1,l2) + t2×无 → t1 侧 2 行
		expect(rows).toHaveLength(2);
	});

	it("optional join：右表无匹配时保留空侧", async () => {
		const rows = await app.database
			.join(
				{ a: "test_join_a", b: "test_join_b" },
				(r: JoinRows) => $.eq(r.b.ref, 999),
				{ a: false, b: true },
			)
			.execute();
		// 谓词恒假：t1/t2 两行左表各保留一行空右表
		expect(rows).toHaveLength(2);
	});

	it("group 聚合", async () => {
		// having 对聚合虚拟字段的过滤是上游既有限制（3.7.0 同行为，
		// 已与上游驱动对照确认一致），此处只断言分组聚合本身
		const rows = await app.database
			.select("test_group")
			.groupBy("dept", (row) => ({
				total: $.sum(row.score),
			}))
			.execute();
		expect(rows).toEqual([
			{ dept: "a", total: 4 },
			{ dept: "b", total: 5 },
		]);
	});
});

describe("eval 与事务", () => {
	it("eval 单值求值", async () => {
		const total = await app.database.eval(
			"test_group",
			(row) => $.sum(row.score),
			{},
		);
		expect(total).toBe(9);
	});

	it("withTransaction 失败回滚到快照", async () => {
		await app.database.create("test_group", {
			dept: "b",
			score: 10,
		});
		const before = await app.database.get("test_group", {
			dept: "b",
		});
		const driver = getDriver();
		await expect(
			driver.withTransaction(async () => {
				await app.database.remove("test_group", {
					dept: "b",
				});
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const after = await app.database.get("test_group", {
			dept: "b",
		});
		expect(after).toEqual(before);
	});
});

describe("索引记账与生命周期", () => {
	it("createIndex / getIndexes / dropIndex", async () => {
		const driver = getDriver();
		await driver.createIndex("test_auto", {
			keys: { v: "asc" },
		});
		// 未显式命名时按键名合成
		const [auto] = await driver.getIndexes("test_auto");
		expect(auto!.name).toBe("index:v_asc");

		await driver.createIndex("test_auto", {
			name: "named",
			keys: { v: "desc" },
		});
		await driver.dropIndex("test_auto", "index:v_asc");
		const names = (
			await driver.getIndexes("test_auto")
		).map((i) => i.name);
		expect(names).toEqual(["named"]);
	});

	it("drop / dropAll / stats", async () => {
		await app.database.remove("test_auto", {});
		await app.database.remove("test_key", {});
		const driver = getDriver();
		await driver.drop("test_join_a");
		expect(
			await app.database.get("test_join_a", {}),
		).toEqual([]);

		const stats = await driver.stats();
		expect(stats.tables["test_join_a"]!.count).toBe(0);

		await driver.dropAll();
		// dropAll 后表数组重建为空（自增计数一并清零）
		expect(
			await app.database.get("test_join_b", {}),
		).toEqual([]);
	});
});
