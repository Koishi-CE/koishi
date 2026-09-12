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
	createHash,
	pbkdf2Sync,
	randomBytes,
} from "node:crypto";
import { Time } from "@koishi-ce/koishi";
import {
	app,
	loginAdmin,
	service,
	startApp,
	stopApp,
	TestClient,
} from "./helpers.ts";

beforeAll(startApp);
afterAll(stopApp);

describe("@koishi-ce/plugin-auth", () => {
	describe("密码登录", () => {
		it("密码错误与账户缺失时拒绝", async () => {
			const client = new TestClient(service());
			const wrong = await client.call("login/password", [
				"root",
				"wrong-pass",
			]);
			expect(wrong.error).toContain("用户名或密码错误");
			const missing = await client.call("login/password", [
				"nobody",
				"x",
			]);
			expect(missing.error).toContain("用户名或密码错误");
			client.close();
		});

		it("登录成功签发令牌并下发登录态", async () => {
			const client = new TestClient(service(), {
				"user-agent": "test-agent",
				"x-forwarded-for": "1.2.3.4",
			});
			const response = await client.call("login/password", [
				"root",
				"admin-pass",
			]);
			expect(response.error).toBeUndefined();
			expect(client.client.auth?.id).toBe(0);
			expect(client.client.auth?.token).toHaveLength(40);

			// 令牌落库记录来源信息（auth 已由上方断言保证存在）
			const [row] = await app.database.get("token", {
				token: client.client.auth!.token,
			});
			expect(row?.userAgent).toBe("test-agent");
			expect(row?.address).toBe("1.2.3.4");
			expect(row?.type).toBe("password");
			expect(row?.expiredAt).toBeGreaterThan(Date.now());

			// 下发的 user 数据附带会话与绑定明细
			const data = client.lastUserData();
			expect(data?.name).toBe("root");
			expect(Array.isArray(data?.tokens)).toBe(true);
			client.close();
		});

		it("旧版无盐 SHA-256 哈希校验通过后透明升级", async () => {
			const legacy = createHash("sha256")
				.update("legacy-pass")
				.digest("hex");
			await app.database.set("user", 0, {
				password: legacy,
			});

			const client = new TestClient(service());
			const response = await client.call("login/password", [
				"root",
				"legacy-pass",
			]);
			expect(response.error).toBeUndefined();
			const [row] = await app.database.get(
				"user",
				{ id: 0 },
				["password"],
			);
			expect(row?.password?.startsWith("pbkdf2$")).toBe(
				true,
			);
			client.close();
		});

		it("畸形哈希与空密码一律拒绝", async () => {
			await app.database.set("user", 0, {
				password: "pbkdf2$malformed",
			});
			const malformed = new TestClient(service());
			expect(
				(
					await malformed.call("login/password", [
						"root",
						"x",
					])
				).error,
			).toContain("用户名或密码错误");
			malformed.close();

			await app.database.set("user", 0, {
				password: "not-a-hash-at-all",
			});
			const alien = new TestClient(service());
			expect(
				(await alien.call("login/password", ["root", "x"]))
					.error,
			).toContain("用户名或密码错误");
			alien.close();

			await app.database.set("user", 0, { password: "" });
			const empty = new TestClient(service());
			expect(
				(await empty.call("login/password", ["root", "x"]))
					.error,
			).toContain("用户名或密码错误");
			empty.close();

			// 还原为合法管理员密码（与插件同格式的 PBKDF2 哈希）供后续用例使用
			const salt = randomBytes(16);
			const dk = pbkdf2Sync(
				"admin-pass",
				salt,
				600_000,
				32,
				"sha256",
			);
			await app.database.set("user", 0, {
				password: `pbkdf2$600000$${salt.toString("hex")}$${dk.toString("hex")}`,
			});
		});
	});

	describe("令牌登录", () => {
		it("有效令牌恢复登录态并刷新最后访问时间", async () => {
			const admin = await loginAdmin();
			const token = admin.client.auth?.token;
			expect(token).toBeTruthy();

			const client = new TestClient(service());
			const response = await client.call("login/token", [
				0,
				token,
			]);
			expect(response.error).toBeUndefined();
			expect(client.client.auth?.id).toBe(0);

			const [row] = await app.database.get("token", {
				token: token!,
			});
			expect(row?.lastUsedAt?.valueOf()).toBeGreaterThan(
				row?.createdAt?.valueOf() ?? 0,
			);
			admin.close();
			client.close();
		});

		it("过期 / 不存在 / 用户缺失的令牌被拒绝", async () => {
			await app.database.create("token", {
				id: 0,
				type: "password",
				token: "expired-token",
				expiredAt: Date.now() - 1000,
				createdAt: new Date(),
				lastUsedAt: new Date(),
				userAgent: "ua",
				address: "addr",
			});
			await app.database.create("token", {
				id: 999,
				type: "password",
				token: "ghost-token",
				expiredAt: Date.now() + Time.hour,
				createdAt: new Date(),
				lastUsedAt: new Date(),
				userAgent: "ua",
				address: "addr",
			});

			const client = new TestClient(service());
			expect(
				(
					await client.call("login/token", [
						0,
						"expired-token",
					])
				).error,
			).toContain("令牌已失效");
			expect(
				(
					await client.call("login/token", [
						0,
						"no-such-token",
					])
				).error,
			).toContain("令牌已失效");
			expect(
				(
					await client.call("login/token", [
						999,
						"ghost-token",
					])
				).error,
			).toContain("用户不存在");
			client.close();
		});
	});
});
