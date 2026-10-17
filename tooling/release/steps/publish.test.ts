// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeEach,
	expect,
	test,
} from "bun:test";
import type { PkgInfo } from "../core/workspace.ts";
import { preflightTrustConfigs } from "./publish.ts";

const ID_TOKEN_ENDPOINT = "https://actions.test/id-token";
const ID_TOKEN_KEY = "ACTIONS_ID_TOKEN_REQUEST_URL";
const REQUEST_TOKEN_KEY = "ACTIONS_ID_TOKEN_REQUEST_TOKEN";

/** 还原环境变量，避免污染同文件后续用例。 */
function clearOidcEnv(): void {
	delete process.env[ID_TOKEN_KEY];
	delete process.env[REQUEST_TOKEN_KEY];
}

beforeEach(() => {
	process.env[ID_TOKEN_KEY] = ID_TOKEN_ENDPOINT;
	process.env[REQUEST_TOKEN_KEY] = "request-token";
});

afterAll(clearOidcEnv);

/** 造最小 PkgInfo（预检只读 name / version）。 */
function pkg(name: string, version = "1.0.0"): PkgInfo {
	return {
		name,
		version,
		dir: `/tmp/${name}`,
		manifestPath: `/tmp/${name}/package.json`,
		dependencies: {},
		peerDependencies: {},
		optionalDependencies: {},
		files: [],
	};
}

/** 造「已在 registry 发过」的版本集。 */
function seen(
	...names: string[]
): Map<string, Set<string>> {
	return new Map(
		names.map((name) => [name, new Set(["0.9.0"])]),
	);
}

/** 假 fetch：换 token 端点恒 200，交换按包名给状态；throwsOnIdToken 模拟无权限。 */
function fakeFetch(options: {
	missing?: readonly string[];
	notFoundElsewhere?: boolean;
	idTokenFails?: boolean;
}): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (url.startsWith(ID_TOKEN_ENDPOINT)) {
			if (options.idTokenFails) {
				throw new Error(
					"GitHub id_token 请求失败：HTTP 500",
				);
			}
			return new Response(
				JSON.stringify({ value: "id-token" }),
				{
					status: 200,
				},
			);
		}
		const name = decodeURIComponent(
			url.split("/package/")[1] ?? "",
		);
		if (options.missing?.includes(name)) {
			return new Response(
				JSON.stringify({
					message:
						"OIDC token exchange error - package not found",
				}),
				{ status: 404 },
			);
		}
		if (options.notFoundElsewhere) {
			return new Response("boom", { status: 500 });
		}
		return new Response(
			JSON.stringify({ token: "package-token" }),
			{
				status: 200,
			},
		);
	}) as typeof fetch;
}

test("全部换到 token → 不拦截发布", async () => {
	const blocked = await preflightTrustConfigs(
		[
			pkg("@koishi-ce/plugin-a"),
			pkg("@koishi-ce/plugin-b"),
		],
		seen("@koishi-ce/plugin-a", "@koishi-ce/plugin-b"),
		"[test]",
		fakeFetch({}),
	);
	expect(blocked).toBe(false);
});

test("任一包 404 → 整批拦截（缺配置一次列全）", async () => {
	const blocked = await preflightTrustConfigs(
		[
			pkg("@koishi-ce/plugin-a"),
			pkg("@koishi-ce/plugin-admin"),
		],
		seen("@koishi-ce/plugin-a", "@koishi-ce/plugin-admin"),
		"[test]",
		fakeFetch({ missing: ["@koishi-ce/plugin-admin"] }),
	);
	expect(blocked).toBe(true);
});

test("探测本身失败（非 404）→ 只告警，不拦截", async () => {
	const blocked = await preflightTrustConfigs(
		[pkg("@koishi-ce/plugin-a")],
		seen("@koishi-ce/plugin-a"),
		"[test]",
		fakeFetch({ notFoundElsewhere: true }),
	);
	expect(blocked).toBe(false);
});

test("id_token 取不到 → 跳过预检继续发布（不误拦）", async () => {
	const blocked = await preflightTrustConfigs(
		[pkg("@koishi-ce/plugin-a")],
		seen("@koishi-ce/plugin-a"),
		"[test]",
		fakeFetch({ idTokenFails: true }),
	);
	expect(blocked).toBe(false);
});

test("首发包（registry 无版本）不参与预检，也不发探测请求", async () => {
	let exchangeCalls = 0;
	const counting: typeof fetch = (async (
		input: string | URL | Request,
	) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (url.startsWith(ID_TOKEN_ENDPOINT)) {
			return new Response(
				JSON.stringify({ value: "id-token" }),
				{
					status: 200,
				},
			);
		}
		exchangeCalls += 1;
		return new Response(
			JSON.stringify({ token: "package-token" }),
			{
				status: 200,
			},
		);
	}) as typeof fetch;
	const blocked = await preflightTrustConfigs(
		[pkg("@koishi-ce/plugin-new")],
		seen(),
		"[test]",
		counting,
	);
	expect(blocked).toBe(false);
	expect(exchangeCalls).toBe(0);
});
