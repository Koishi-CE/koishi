// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 权限系统（Permissions）测试。
 *
 * 覆盖内置 authority:N 判定（未登录放行）、自定义权限的
 * define / provide / inherit / depend 关系、test 的依赖与继承展开、
 * 平台侧 checkPermission 与本地授权列表两条兜底、
 * check 抛错的容忍，以及 list() 汇总（含 validate 插件的命令权限闭包）。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import {
	App,
	Context,
	Logger,
	type Session,
	type User,
} from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);

// validate 插件的权限定义依赖命令注册表，注册带选项的命令供 list() 断言
app.command("pv").option("op", "-o");

beforeAll(() => app.start());
afterAll(() => app.stop());

/** 构造部分会话（权限判定只依赖 user / channel / bot 等字段） */
function session(overrides: Partial<Session> = {}) {
	return Object.assign(
		{ platform: "mock", userId: "123", channelId: "c1" },
		overrides,
	) as Partial<Session>;
}

/** 部分用户载荷：按"仅观察 authority 字段"的用户视图收窄 */
function withAuthority(authority: number) {
	return {
		user: { authority } as User.Observed<"authority">,
	};
}

describe("Permissions", () => {
	it("authority:N 用户等级判定", async () => {
		await expect(
			app.permissions.test(
				"authority:1",
				session(withAuthority(2)),
			),
		).resolves.toBe(true);
		await expect(
			app.permissions.test(
				"authority:5",
				session(withAuthority(2)),
			),
		).resolves.toBe(false);
		// 未登录（无 user 记录）时同样放行
		await expect(
			app.permissions.test("authority:1", session()),
		).resolves.toBe(true);
	});

	it("define / provide 自定义权限", async () => {
		app.permissions.provide("vip", (_data, s) => {
			return (s.userId ?? "") === "123";
		});
		await expect(
			app.permissions.test(
				"vip",
				session({ userId: "123" }),
			),
		).resolves.toBe(true);
		await expect(
			app.permissions.test(
				"vip",
				session({ userId: "456" }),
			),
		).resolves.toBe(false);
	});

	it("inherit 满足任一上游权限即通过", async () => {
		app.permissions.inherit("admin", ["authority:2"]);
		await expect(
			app.permissions.test(
				"admin",
				session(withAuthority(2)),
			),
		).resolves.toBe(true);
		await expect(
			app.permissions.test(
				"admin",
				session(withAuthority(1)),
			),
		).resolves.toBe(false);
	});

	it("depend 依赖须全部满足", async () => {
		app.permissions.depend("root", ["authority:5"]);
		await expect(
			app.permissions.test(
				"root",
				session(withAuthority(2)),
			),
		).resolves.toBe(false);
	});

	it("适配器 checkPermission 兜底", async () => {
		await expect(
			app.permissions.test(
				"guild.admin",
				session({
					bot: {
						checkPermission: async () => true,
					} as never,
				}),
			),
		).resolves.toBe(true);
	});

	it("本地授权列表兜底（会话 > 用户 > 频道）", async () => {
		await expect(
			app.permissions.test(
				"perm.x",
				session({ permissions: ["perm.x"] }),
			),
		).resolves.toBe(true);
		await expect(
			app.permissions.test(
				"perm.x",
				session({
					user: { permissions: ["perm.x"] } as never,
				}),
			),
		).resolves.toBe(true);
		await expect(
			app.permissions.test(
				"perm.x",
				session({
					channel: { permissions: ["perm.x"] } as never,
				}),
			),
		).resolves.toBe(true);
		await expect(
			app.permissions.test("perm.x", session()),
		).resolves.toBe(false);
	});

	it("check 抛错按不通过处理且不影响其它规则", async () => {
		// 抛错容忍路径的 app 域告警是被测行为的预期伴生输出，静默之
		(Logger.levels as Record<string, number>)["app"] = 0;
		try {
			app.permissions.provide("boom:(x)", () => {
				throw new Error("check failed");
			});
			await expect(
				app.permissions.test("boom:1", session()),
			).resolves.toBe(false);
		} finally {
			delete (Logger.levels as Record<string, number>)[
				"app"
			];
		}
	});

	it("shadow 会话还原为原始会话再校验", async () => {
		const original = session(withAuthority(3));
		const shadow = {
			[Context.shadow]: original,
		} as Partial<Session>;
		await expect(
			app.permissions.test("authority:2", shadow),
		).resolves.toBe(true);
	});

	it("list 汇总内置等级、命令权限与自定义权限", () => {
		app.permissions.define("custom.perms", {
			list: () => ["custom.a", "custom.b"],
		});
		const list = app.permissions.list();
		expect(list).toContain("authority:0");
		expect(list).toContain("authority:4");
		expect(list).toContain("command:pv");
		expect(list).toContain("command:pv:option:op");
		expect(list).toContain("custom.a");
		expect(list).toContain("custom.b");
	});
});
