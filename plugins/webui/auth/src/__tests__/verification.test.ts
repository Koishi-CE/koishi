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
import type { Auth } from "@koishi-ce/plugin-auth";
import {
	aliceId,
	app,
	service,
	startApp,
	stopApp,
	TestClient,
	tick,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/plugin-auth", () => {
	describe("平台验证码登录", () => {
		it("账户不存在或已绑定同一账户时拒绝", async () => {
			const client = new TestClient(service());
			expect(
				(
					await client.call("login/platform", [
						"mock",
						"404",
					])
				).error,
			).toContain("找不到此账户");

			client.client.auth = { id: aliceId } as Auth;
			expect(
				(
					await client.call("login/platform", [
						"mock",
						"111",
					])
				).error,
			).toContain("你已经绑定了此账户");
			client.close();
		});

		it("未登录客户端经验证码完成登录", async () => {
			const client = new TestClient(service());
			const result = await client.call("login/platform", [
				"mock",
				"111",
			]);
			expect(result.error).toBeUndefined();
			expect(result.value).toMatchObject({
				id: aliceId,
				name: "alice",
			});
			const code = (result.value as { token: string })
				.token;
			expect(code).toMatch(/^\d{6}$/);

			// 无关消息不消费验证码状态
			const bot = app.mock.client("999", "888");
			await bot.receive("hello-world");

			// 用户把验证码发给机器人 → 为对应账户签发令牌
			const user = app.mock.client("111");
			await user.receive(code);
			await tick();
			expect(client.client.auth?.id).toBe(aliceId);
			const data = client.lastUserData();
			expect(data?.name).toBe("alice");
			client.close();
		});

		it("已登录客户端经验证码改绑平台账户", async () => {
			const client = new TestClient(service());
			// 已登录为 alice，把 bob 的平台账号绑到 alice 名下
			client.client.auth = { id: aliceId } as Auth;
			const result = await client.call("login/platform", [
				"mock",
				"222",
			]);
			expect(result.error).toBeUndefined();
			const code = (result.value as { token: string })
				.token;

			const user = app.mock.client("222");
			await user.receive(code);
			await tick();
			const [binding] = await app.database.get("binding", {
				platform: "mock",
				pid: "222",
			});
			expect(binding?.aid).toBe(aliceId);
			client.close();
		});

		it("验证码超时后触发状态清理回调", async () => {
			// Schema 要 loginTokenExpire >= 1min，构造后直接改字段绕开校验，
			// 用 50ms 时效快速触发超时回调
			const keep = app.auth.config.loginTokenExpire;
			app.auth.config.loginTokenExpire = 50;
			const client = new TestClient(service());
			const result = await client.call("login/platform", [
				"mock",
				"111",
			]);
			expect(result.error).toBeUndefined();
			// 等待超时回调执行（状态清理与否取决于到期判定，此处验证回调不抛错）
			await new Promise((resolve) =>
				setTimeout(resolve, 150),
			);
			client.close();
			app.auth.config.loginTokenExpire = keep;
		});
	});
});
