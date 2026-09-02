// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 新平台接入时的用户表动态迁移测试（database/index.ts 的 login-added 监听）。
 *
 * 触发 login-added 后：user 表动态补充该平台字段，存量数据迁移到
 * binding 绑定表；同一平台重复触发时直接短路。
 * 迁移回调由外部迁移工具调用 driver.migrate 驱动（memory 驱动自身
 * 不主动执行迁移），测试中手动驱动以覆盖该链路。
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { App } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import * as memoryModule from "@koishijs/plugin-database-memory";
import "./shape.ts";

// CJS 实现配 ESM 声明，Bun 互操作视图多包一层 default，穿透取真实驱动
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

const app = new App();
app.plugin(mock);
app.plugin(memory);

/** 支持迁移钩子的驱动形态（minato Driver 的最小结构） */
type MigratableDriver = {
	migrate(name: string, hooks: Record<string, unknown>): Promise<void>;
};

beforeAll(async () => {
	await app.start();
	await app.database.createUser("mock", "u1", { authority: 1 });
});

afterAll(() => app.stop());

/** 手动驱动一次 user 表迁移（等价于外部迁移工具的调用方式） */
function runMigration() {
	const driver = (app.database as unknown as { drivers: MigratableDriver[] })
		.drivers[0];
	return driver!.migrate("user", {
		before: () => true,
		after: () => {},
		finalize: () => {},
		error: (reason: unknown) => {
			throw reason;
		},
	});
}

describe("Login Migration", () => {
	it("新平台触发 user 表字段补充与存量数据迁移", async () => {
		// tables 为索引字典：方括号取表并收窄后复用
		const userTable = app.model.tables["user"]!;
		expect("newplat" in userTable.fields).toBe(false);
		app.emit("login-added", { platform: "newplat" } as never);
		expect("newplat" in userTable.fields).toBe(true);

		// 模拟老版本数据：存量用户的平台字段仍写在 user 表上
		await app.database.set("user", { id: 1 }, { newplat: "p1" } as never);
		await runMigration();
		// 迁移把存量数据搬入 binding 绑定表
		await expect(
			app.database.get("binding", { platform: "newplat" }),
		).resolves.toHaveShape([{ aid: 1, bid: 1, pid: "p1" }]);
	});

	it("同一平台重复触发直接短路", async () => {
		const userTable = app.model.tables["user"]!;
		const fields = Object.keys(userTable.fields).length;
		app.emit("login-added", { platform: "newplat" } as never);
		await runMigration();
		expect(Object.keys(userTable.fields)).toHaveLength(fields);
	});
});
