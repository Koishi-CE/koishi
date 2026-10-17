// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeEach,
	expect,
	test,
} from "bun:test";
import {
	escapePackageName,
	exchangeUrl,
	fetchGithubIdToken,
	probePackageTrust,
} from "./trust.ts";

const ID_TOKEN = "header.payload.signature";
const ID_TOKEN_ENDPOINT = "https://actions.test/id-token";
const ID_TOKEN_KEY = "ACTIONS_ID_TOKEN_REQUEST_URL";
const REQUEST_TOKEN_KEY = "ACTIONS_ID_TOKEN_REQUEST_TOKEN";

beforeEach(() => {
	process.env[ID_TOKEN_KEY] = ID_TOKEN_ENDPOINT;
	process.env[REQUEST_TOKEN_KEY] = "request-token";
});

afterAll(() => {
	delete process.env[ID_TOKEN_KEY];
	delete process.env[REQUEST_TOKEN_KEY];
});

test("包名转路径段：作用域名只转斜杠，@ 保留（与 npm CLI 一致）", () => {
	expect(escapePackageName("@koishi-ce/plugin-admin")).toBe(
		"@koishi-ce%2Fplugin-admin",
	);
	expect(escapePackageName("create-koishi-ce")).toBe(
		"create-koishi-ce",
	);
	expect(exchangeUrl("@koishi-ce/core")).toBe(
		"https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@koishi-ce%2Fcore",
	);
});

test("换到 token → ok（token 不外泄，detail 不含凭证）", async () => {
	const result = await probePackageTrust(
		ID_TOKEN,
		"@koishi-ce/plugin-admin",
		async () =>
			new Response(
				JSON.stringify({ token: "package-scoped" }),
				{
					status: 200,
				},
			),
	);
	expect(result.status).toBe("ok");
	expect(result.detail).not.toContain("package-scoped");
});

test("404 → missing（没配 / claim 不符 / 已过期，npm 同码）", async () => {
	const result = await probePackageTrust(
		ID_TOKEN,
		"@koishi-ce/plugin-admin",
		async () =>
			new Response(
				JSON.stringify({
					message:
						"OIDC token exchange error - package not found",
				}),
				{ status: 404 },
			),
	);
	expect(result.status).toBe("missing");
	expect(result.detail).toContain("package not found");
});

test("200 但响应缺 token → error（不当成通过）", async () => {
	const result = await probePackageTrust(
		ID_TOKEN,
		"@koishi-ce/plugin-admin",
		async () => new Response("{}", { status: 200 }),
	);
	expect(result.status).toBe("error");
});

test("非 404 的失败 → error（不据此拦截发布）", async () => {
	const result = await probePackageTrust(
		ID_TOKEN,
		"@koishi-ce/plugin-admin",
		async () =>
			new Response("rate limited", { status: 429 }),
	);
	expect(result.status).toBe("error");
	expect(result.detail).toContain("429");
});

test("网络异常 → error（不抛、不中断整批探测）", async () => {
	const result = await probePackageTrust(
		ID_TOKEN,
		"@koishi-ce/plugin-admin",
		async () => {
			throw new Error("ECONNRESET");
		},
	);
	expect(result.status).toBe("error");
	expect(result.detail).toContain("ECONNRESET");
});

test("换 token 200 但响应无法解析 → error", async () => {
	const result = await probePackageTrust(
		ID_TOKEN,
		"@koishi-ce/plugin-admin",
		async () => new Response("not json", { status: 200 }),
	);
	expect(result.status).toBe("error");
});

test("换 token 200 但 token 为空串 → error（不算可用配置）", async () => {
	const result = await probePackageTrust(
		ID_TOKEN,
		"@koishi-ce/plugin-admin",
		async () =>
			new Response(JSON.stringify({ token: "" }), {
				status: 200,
			}),
	);
	expect(result.status).toBe("error");
});

test("id_token 请求：audience 与 npm CLI 一致，用 request token 换 id token", async () => {
	let requested = "";
	const token = await fetchGithubIdToken((async (input) => {
		requested = String(input);
		return new Response(
			JSON.stringify({ value: "id-token" }),
			{
				status: 200,
			},
		);
	}) as typeof fetch);
	expect(token).toBe("id-token");
	const url = new URL(requested);
	expect(url.origin + url.pathname).toBe(ID_TOKEN_ENDPOINT);
	expect(url.searchParams.get("audience")).toBe(
		"npm:registry.npmjs.org",
	);
});

test("id_token 请求非 2xx / 响应缺 value → 抛错（由调用方决定是否拦截）", async () => {
	await expect(
		fetchGithubIdToken(
			(async () =>
				new Response("nope", {
					status: 500,
				})) as typeof fetch,
		),
	).rejects.toThrow("HTTP 500");
	await expect(
		fetchGithubIdToken(
			(async () =>
				new Response(JSON.stringify({}), {
					status: 200,
				})) as typeof fetch,
		),
	).rejects.toThrow("缺少 value");
});

test("缺 Actions 的 id_token 环境变量 → 直接抛错，不发请求", async () => {
	delete process.env[ID_TOKEN_KEY];
	let called = 0;
	const fake = (async () => {
		called += 1;
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	await expect(fetchGithubIdToken(fake)).rejects.toThrow(
		"ACTIONS_ID_TOKEN_REQUEST_URL",
	);
	expect(called).toBe(0);
});
