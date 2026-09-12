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
import { Time } from "@koishi-ce/koishi";
import {
	type Auth,
	randomId,
} from "@koishi-ce/plugin-auth";
import {
	app,
	bobId,
	loginAdmin,
	service,
	startApp,
	stopApp,
	TestClient,
} from "./helpers.ts";

// 声明测试专用事件（带权限门槛），驱动 console/intercept 鉴权链路
declare module "@koishi-ce/console" {
	interface Events {
		"test/admin-only"(): string;
	}
}

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/plugin-auth", () => {
	it("启动时创建管理员账户；randomId 生成随机令牌", async () => {
		const [admin] = await app.database.get("user", {
			id: 0,
		});
		expect(admin?.name).toBe("root");
		expect(admin?.authority).toBe(5);
		expect(admin?.password?.startsWith("pbkdf2$")).toBe(
			true,
		);
		expect(randomId(8)).toMatch(/^[0-9a-zA-Z]{8}$/);
		expect(randomId()).toHaveLength(40);
	});

	describe("权限拦截（console/intercept）", () => {
		it("按登录态与权限等级拦截事件", async () => {
			app.console.addListener(
				"test/admin-only",
				() => "secret",
				{
					authority: 4,
				},
			);

			// 未登录：拦截
			const anonymous = new TestClient(service());
			expect(
				(await anonymous.call("test/admin-only", [])).error,
			).toBe("unauthorized");
			anonymous.close();

			// 权限不足：拦截
			const low = new TestClient(service());
			low.client.auth = {
				id: bobId,
				authority: 1,
				expiredAt: Date.now() + Time.hour,
				token: "t",
			} as Auth;
			expect(
				(await low.call("test/admin-only", [])).error,
			).toBe("unauthorized");
			low.close();

			// 令牌过期：拦截
			const expired = new TestClient(service());
			expired.client.auth = {
				id: 0,
				authority: 5,
				expiredAt: Date.now() - 1,
				token: "t",
			} as Auth;
			expect(
				(await expired.call("test/admin-only", [])).error,
			).toBe("unauthorized");
			expired.close();

			// 管理员：放行
			const admin = await loginAdmin();
			expect(
				(await admin.call("test/admin-only", [])).value,
			).toBe("secret");
			admin.close();
		});
	});
});
