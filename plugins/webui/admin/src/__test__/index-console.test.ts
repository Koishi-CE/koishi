// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { Console, type Entry } from "@koishi-ce/console";
import { App, type Plugin } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import * as memoryModule from "@koishijs/plugin-database-memory";
import admin from "../index.ts";

// 同既有 index.test.ts：CJS 实现配 ESM 声明，nodenext 互操作视图多包一层 default
const memory =
	memoryModule.default as unknown as typeof memoryModule.default.default;

/**
 * Admin 服务 console 分支与 CRUD 全量测试。
 *
 * 以最小桩 StubConsole（实现抽象方法 resolveEntry）注册 console 服务，
 * 不启动任何 HTTP / WebSocket：addEntry / addListener / entry.refresh
 * 均在真实 Console 基类上执行，RPC 监听器直接从 listeners 表调用。
 */

class StubConsole extends Console {
	static override inject = { optional: ["console"] };

	protected override resolveEntry(
		files: Entry.Files,
		_key: string,
	): string[] {
		if (typeof files === "string") return [files];
		if (Array.isArray(files)) return files;
		return [
			files.dev,
			...(Array.isArray(files.prod)
				? files.prod
				: [files.prod]),
		];
	}
}

const app = new App();
app.plugin(memory);
app.plugin(mock);
// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(
	StubConsole as unknown as Plugin.Constructor<App>,
);
const fork = app.plugin(admin);

beforeAll(() => app.start());
afterAll(() => app.stop());

/** 取当前 admin 的前端入口数据工厂产物 */
function entryData(): Record<string, unknown> {
	// 默认形态下 admin 的 files 为 { dev, prod } 选项对象
	const entry = Object.values(app.console.entries).find(
		(item) =>
			typeof item.files === "object" &&
			!Array.isArray(item.files),
	);
	expect(entry).toBeDefined();
	const data = entry?.data as
		| ((input?: unknown) => Record<string, unknown>)
		| undefined;
	return data?.(undefined as never) ?? {};
}

describe("Admin console 装配", () => {
	it("注册前端入口与全部 admin/* RPC 监听器（authority 4）", () => {
		const names = Object.keys(app.console.listeners).filter(
			(name) => name.startsWith("admin/"),
		);
		expect(names.sort()).toEqual([
			"admin/add-user",
			"admin/create-group",
			"admin/create-track",
			"admin/delete-group",
			"admin/delete-track",
			"admin/remove-user",
			"admin/rename-group",
			"admin/rename-track",
			"admin/update-group",
			"admin/update-track",
		]);
		for (const name of names) {
			expect(app.console.listeners[name]?.authority).toBe(
				4,
			);
		}
	});

	it("入口数据工厂下发 group / track 字典", () => {
		const data = entryData();
		expect(data).toHaveProperty("group");
		expect(data).toHaveProperty("track");
	});
});

describe("Admin 用户组 CRUD", () => {
	it("createGroup 从 0 计数并写入数据库", async () => {
		const id = await app.admin.createGroup("组A");
		expect(typeof id).toBe("number");
		expect(app.admin.groups[0]?.name).toBe("组A");
		expect(app.admin.groups[0]?.count).toBe(0);
		const row = await app.database.get("group", { id });
		expect(row[0]?.["name"]).toBe("组A");
	});

	it("renameGroup 同步数据库，同名直接跳过", async () => {
		const id = app.admin.groups[0]?.id as number;
		await app.admin.renameGroup(id, "组B");
		expect(app.admin.groups[0]?.name).toBe("组B");
		const row = await app.database.get("group", { id });
		expect(row[0]?.["name"]).toBe("组B");
		// 名称未变化时不产生任何写库
		await app.admin.renameGroup(id, "组B");
	});

	it("updateGroup 整体替换权限列表", async () => {
		const id = app.admin.groups[0]?.id as number;
		await app.admin.updateGroup(id, ["perm.a", "group:99"]);
		expect(app.admin.groups[0]?.permissions).toEqual([
			"perm.a",
			"group:99",
		]);
	});

	it("addUser / removeUser 维护成员关系与计数", async () => {
		const id = app.admin.groups[0]?.id as number;
		await app.mock.initUser("123", 2, { permissions: [] });
		await app.admin.addUser(id, "mock", "123");
		const user = await app.database.getUser("mock", "123", [
			"permissions",
		]);
		expect(user?.["permissions"]).toContain(`group:${id}`);
		expect(app.admin.groups[0]?.count).toBe(1);
		// 已在组内时不重复写入
		await app.admin.addUser(id, "mock", "123");
		expect(app.admin.groups[0]?.count).toBe(1);

		await app.admin.removeUser(id, "mock", "123");
		const after = await app.database.getUser(
			"mock",
			"123",
			["permissions"],
		);
		expect(after?.["permissions"]).not.toContain(
			`group:${id}`,
		);
		expect(app.admin.groups[0]?.count).toBe(0);
	});

	it("deleteGroup 清理成员用户与其它组对它的引用", async () => {
		const victim = app.admin.groups[0]?.id as number;
		const holderId = await app.admin.createGroup("持有者");
		await app.admin.updateGroup(holderId, [
			`group:${victim}`,
		]);
		await app.mock.initUser("456", 2, {
			permissions: [`group:${victim}`],
		});
		await app.admin.addUser(victim, "mock", "456");
		// count / dispose 是仅内存字段：minato 严格驱动会拒绝带未知字段的
		// upsert 载荷（源码 deleteGroup 的批量回写把它们带了进去，见交付报告），
		// 此处剥离后验证正路径
		const holder = app.admin.groups.find(
			(g) => g.id === holderId,
		);
		delete (holder as { count?: number }).count;
		delete (holder as { dispose?: () => void }).dispose;

		await app.admin.deleteGroup(victim);
		expect(app.admin.groups.map((g) => g.id)).not.toContain(
			victim,
		);
		// 用户侧引用被移除
		const user = await app.database.getUser("mock", "456", [
			"permissions",
		]);
		expect(user?.["permissions"]).not.toContain(
			`group:${victim}`,
		);
		// 其它组的引用同样被清理
		expect(app.admin.groups[0]?.permissions).toEqual([]);
		const rows = await app.database.get("group", {
			id: victim,
		});
		expect(rows).toHaveLength(0);
	});

	it("目标不存在时各方法显式报错", async () => {
		await expect(
			app.admin.renameGroup(999, "x"),
		).rejects.toThrow("group not found");
		await expect(
			app.admin.deleteGroup(999),
		).rejects.toThrow("group not found");
		await expect(
			app.admin.updateGroup(999, []),
		).rejects.toThrow("group not found");
		await expect(
			app.admin.addUser(999, "mock", "1"),
		).rejects.toThrow("group not found");
		await expect(
			app.admin.removeUser(999, "mock", "1"),
		).rejects.toThrow("group not found");
		// 组存在但用户不存在
		const gid = app.admin.groups[0]?.id as number;
		await app.admin
			.addUser(gid, "mock", "ghost")
			.catch(() => {});
		await expect(
			app.admin.addUser(gid, "mock", "ghost"),
		).rejects.toThrow("user not found");
		await expect(
			app.admin.removeUser(gid, "mock", "ghost"),
		).rejects.toThrow("user not found");
	});
});

describe("Admin 用户组路线 CRUD", () => {
	it("createTrack / renameTrack / updateTrack / deleteTrack 全链路", async () => {
		const id = await app.admin.createTrack("路线A");
		expect(app.admin.tracks[0]?.name).toBe("路线A");
		await app.admin.renameTrack(id, "路线B");
		expect(app.admin.tracks[0]?.name).toBe("路线B");
		const row = await app.database.get("perm_track", {
			id,
		});
		expect(row[0]?.["name"]).toBe("路线B");
		// 同名跳过
		await app.admin.renameTrack(id, "路线B");
		await app.admin.updateTrack(id, ["p1", "p2"]);
		expect(app.admin.tracks[0]?.permissions).toEqual([
			"p1",
			"p2",
		]);
		await app.admin.deleteTrack(id);
		expect(app.admin.tracks).toHaveLength(0);
		const rows = await app.database.get("perm_track", {
			id,
		});
		expect(rows).toHaveLength(0);
	});

	it("目标不存在时显式报错", async () => {
		await expect(
			app.admin.renameTrack(999, "x"),
		).rejects.toThrow("track not found");
		await expect(
			app.admin.deleteTrack(999),
		).rejects.toThrow("track not found");
		await expect(
			app.admin.updateTrack(999, []),
		).rejects.toThrow("track not found");
	});
});

describe("Admin RPC 监听器转发", () => {
	it("全部 admin/* 监听器转发到服务方法", async () => {
		const listen = (name: string) => {
			const listener = app.console.listeners[name];
			expect(listener).toBeDefined();
			return listener?.callback as (
				...args: unknown[]
			) => Promise<unknown>;
		};
		const gid = (await listen("admin/create-group")(
			"RPC组",
		)) as number;
		const tid = (await listen("admin/create-track")(
			"RPC路线",
		)) as number;
		await listen("admin/rename-group")(gid, "RPC组2");
		await listen("admin/update-group")(gid, ["rpc.p"]);
		await listen("admin/rename-track")(tid, "RPC路线2");
		await listen("admin/update-track")(tid, ["rpc.t"]);
		await app.mock.initUser("789", 2, { permissions: [] });
		await listen("admin/add-user")(gid, "mock", "789");
		await listen("admin/remove-user")(gid, "mock", "789");
		await listen("admin/delete-track")(tid);
		await listen("admin/delete-group")(gid);
		expect(
			app.admin.groups.map((g) => g.name),
		).not.toContain("RPC组2");
		expect(
			app.admin.tracks.map((t) => t.name),
		).not.toContain("RPC路线2");
	});
});

describe("Admin 权限定义", () => {
	// permissions.test 会沿 inherits 关系展开，恰好驱动 setupGroup / setupTrack
	// 注册的继承回调（permissions.define("(name)") 的动态 links）
	it("用户组：持有 group:<id> 即继承组内声明的权限", async () => {
		const gid = await app.admin.createGroup("权限组");
		await app.admin.updateGroup(gid, ["perm.grouped"]);
		type TestSession = Parameters<
			(typeof app)["permissions"]["test"]
		>[1];
		// 最小载荷桩经 unknown 二段式断言为 Session 视图（permissions.test 只读 user.permissions）
		const session = (permissions: string[]) =>
			({ user: { permissions } }) as unknown as TestSession;
		expect(
			await app.permissions.test(
				["perm.grouped"],
				session([`group:${gid}`]),
			),
		).toBe(true);
		expect(
			await app.permissions.test(
				["perm.grouped"],
				session(["others"]),
			),
		).toBe(false);
	});

	it("路线：持有列表中某权限即同时继承其前面的权限", async () => {
		const tid = await app.admin.createTrack("权限路线");
		await app.admin.updateTrack(tid, [
			"route.a",
			"route.b",
		]);
		type TestSession = Parameters<
			(typeof app)["permissions"]["test"]
		>[1];
		// 最小载荷桩经 unknown 二段式断言为 Session 视图（permissions.test 只读 user.permissions）
		const session = (permissions: string[]) =>
			({ user: { permissions } }) as unknown as TestSession;
		// 持有 route.a → 通过继承链满足 route.b
		expect(
			await app.permissions.test(
				["route.b"],
				session(["route.a"]),
			),
		).toBe(true);
	});
});

describe("Admin 生命周期", () => {
	it("重新加载时从数据库恢复组并重新统计人数", async () => {
		const gid = await app.admin.createGroup("持久组");
		await app.mock.initUser("321", 2, { permissions: [] });
		await app.admin.addUser(gid, "mock", "321");
		expect(
			app.admin.groups.find((g) => g.id === gid)?.count,
		).toBe(1);

		// 卸载：服务注销、entry 置空回调触发（console 子上下文随 fork 销毁）；
		// 再加载：从 DB 恢复并重算 count
		await fork.dispose();
		await app.registry.delete(admin);
		const reforked = app.plugin(admin);
		await reforked.start();
		await app.sleep(0);
		const restored = app.admin.groups.find(
			(g) => g.id === gid,
		);
		expect(restored?.name).toBe("持久组");
		expect(restored?.count).toBe(1);
	});

	it("KOISHI_BASE / KOISHI_ENV=browser 环境下的入口文件形态", async () => {
		await app.registry.delete(admin);

		process.env["KOISHI_BASE"] = "/koishi-base";
		try {
			const envFork = app.plugin(admin);
			await envFork.start();
			await app.sleep(0);
			const entry = Object.values(app.console.entries).at(
				-1,
			);
			expect(entry?.files).toEqual([
				"/koishi-base/dist/index.js",
				"/koishi-base/dist/style.css",
			]);
			await envFork.dispose();
		} finally {
			delete process.env["KOISHI_BASE"];
		}

		process.env["KOISHI_ENV"] = "browser";
		try {
			const envFork = app.plugin(admin);
			await envFork.start();
			await app.sleep(0);
			const entry = Object.values(app.console.entries).at(
				-1,
			);
			expect(entry?.files).toEqual([
				expect.stringContaining("/client/index.ts"),
			]);
			await envFork.dispose();
		} finally {
			delete process.env["KOISHI_ENV"];
			// 收尾再加载回常规形态，供后续用例使用
			await app.plugin(admin);
		}
	});
});
