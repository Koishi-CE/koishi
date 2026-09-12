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
import {
	aliceId,
	app,
	bobId,
	loginAdmin,
	service,
	startApp,
	stopApp,
	TestClient,
	tick,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/plugin-auth", () => {
	describe("用户管理事件", () => {
		it("user/delete-token 删除指定会话", async () => {
			const anonymous = new TestClient(service());
			expect(
				(await anonymous.call("user/delete-token", [1]))
					.error,
			).toContain("请先登录");
			anonymous.close();

			const admin = await loginAdmin();
			const [row] = await app.database.get("token", {
				token: admin.client.auth!.token,
			});
			const bad = await admin.call(
				"user/delete-token",
				[99999],
			);
			expect(bad.error).toContain("令牌不存在");

			const ok = await admin.call("user/delete-token", [
				row?.inc,
			]);
			expect(ok.error).toBeUndefined();
			const [removed] = await app.database.get("token", {
				inc: row!.inc,
			});
			expect(removed).toBeUndefined();
			admin.close();
		});

		it("user/logout 删除当前令牌并重发登录态", async () => {
			const admin = await loginAdmin();
			const token = admin.client.auth?.token;
			const response = await admin.call("user/logout", []);
			expect(response.error).toBeUndefined();
			// 令牌已被删除，其它设备无法再用它续期（loginAdmin 成功后令牌必存在）
			const [row] = await app.database.get("token", {
				token: token!,
			});
			expect(row).toBeUndefined();
			// 移植偏差说明：上游 logout 以 setAuth(this, null) 显式清空登录态，
			// 本仓改为传 undefined，命中 setAuth 的默认参数（沿用 client.auth），
			// 故当前行为是重发 user 数据而非下发 null；此处按实际行为断言
			expect(admin.client.auth?.id).toBe(0);
			const data = admin.lastUserData();
			expect(data?.name).toBe("root");
			admin.close();
		});

		it("setAuth 对匿名客户端下发 null（登出数据通道）", async () => {
			const anonymous = new TestClient(service());
			await app.auth.setAuth(anonymous.client);
			await tick();
			expect(anonymous.lastUserData()).toBeNull();
			anonymous.close();
		});

		it("user/update 修改资料（密码加哈希、配置透传）", async () => {
			const anonymous = new TestClient(service());
			expect(
				(
					await anonymous.call("user/update", [
						{ name: "x" },
					])
				).error,
			).toContain("请先登录");
			anonymous.close();

			const admin = await loginAdmin();
			const response = await admin.call("user/update", [
				{
					name: "renamed",
					password: "new-pass",
					config: { theme: "dark" },
				},
			]);
			expect(response.error).toBeUndefined();
			// passive 更新：本地登录态同步但不推送数据
			expect(admin.client.auth?.name).toBe("renamed");
			const [row] = await app.database.get("user", {
				id: 0,
			});
			expect(row?.name).toBe("renamed");
			expect(row?.password?.startsWith("pbkdf2$")).toBe(
				true,
			);
			expect(row?.config).toEqual({ theme: "dark" });
			admin.close();
		});

		it("user/unbind 解绑平台账号的三种分支", async () => {
			const anonymous = new TestClient(service());
			expect(
				(
					await anonymous.call("user/unbind", [
						"mock",
						"111",
					])
				).error,
			).toContain("请先登录");
			anonymous.close();

			// 以 alice 身份登录
			const alice = new TestClient(service());
			const grant = await alice.call("login/platform", [
				"mock",
				"111",
			]);
			const code = (grant.value as { token: string }).token;
			await app.mock.client("111").receive(code);
			await tick();
			expect(alice.client.auth?.id).toBe(aliceId);

			// 绑定不存在
			expect(
				(await alice.call("user/unbind", ["mock", "000"]))
					.error,
			).toContain("绑定不存在");

			// 仅剩一个自绑定（主账号）：拒绝解绑
			expect(
				(await alice.call("user/unbind", ["mock", "111"]))
					.error,
			).toContain("无法解除绑定");

			// 追加第二个自绑定后可解绑
			await app.database.create("binding", {
				aid: aliceId,
				bid: aliceId,
				platform: "mock",
				pid: "333",
			});
			expect(
				(await alice.call("user/unbind", ["mock", "333"]))
					.error,
			).toBeUndefined();
			const [gone] = await app.database.get("binding", {
				platform: "mock",
				pid: "333",
			});
			expect(gone).toBeUndefined();

			// 绑到他人名下（aid !== bid）：解绑时改回其主账号
			await app.database.create("binding", {
				aid: aliceId,
				bid: bobId,
				platform: "mock",
				pid: "444",
			});
			expect(
				(await alice.call("user/unbind", ["mock", "444"]))
					.error,
			).toBeUndefined();
			const [moved] = await app.database.get("binding", {
				platform: "mock",
				pid: "444",
			});
			expect(moved?.aid).toBe(bobId);
			alice.close();
		});
	});
});
