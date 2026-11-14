// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { captureNpm, runPool } from "./utils.ts";
// npm registry / npm CLI 查询层。RELEASE_REGISTRY 环境变量可切换查询源
// （tarball 发布始终走 npm CLI 当前配置，与本查询源解耦）；registry 直连在
// 部分网络环境不稳定：15s 超时 + 3 次退避重试，404 视为首发（空集）。
import type { PkgInfo } from "./workspace.ts";

/** registry 查询源（可用 RELEASE_REGISTRY 环境变量覆盖）。 */
export const REGISTRY =
	process.env["RELEASE_REGISTRY"] ??
	"https://registry.npmjs.org";

/**
 * OIDC 可信发布环境（job 显式声明 `permissions: id-token: write` 时 GitHub
 * 才注入 ACTIONS_ID_TOKEN_REQUEST_URL）。该模式没有 npm 登录态：publish 时
 * npm 用 id_token 换包级短时 token，`npm whoami` / `npm owner ls` 必然失败，
 * 依赖登录态的预检必须跳过。
 */
export function isOidcTrustedPublishing(): boolean {
	return (
		(process.env["ACTIONS_ID_TOKEN_REQUEST_URL"] ?? "") !==
		""
	);
}

/** 查询单包全部已发布版本；404 → 空集（首发），其余失败重试 3 次后抛错。 */
async function fetchPublishedVersions(
	name: string,
): Promise<Set<string>> {
	const url = `${REGISTRY}/${name.replaceAll("/", "%2F")}`;
	let lastError: unknown = new Error("unreachable");
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const res = await fetch(url, {
				headers: {
					accept:
						"application/vnd.npm.install-v1+json, application/json",
				},
				signal: AbortSignal.timeout(15_000),
			});
			if (res.status === 404) return new Set();
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as {
				versions?: Record<string, unknown>;
			};
			return new Set(Object.keys(json["versions"] ?? {}));
		} catch (err) {
			lastError = err;
			if (attempt < 3) {
				await new Promise((resolve) =>
					setTimeout(resolve, attempt * 2000),
				);
			}
		}
	}
	const message =
		lastError instanceof Error
			? lastError.message
			: String(lastError);
	throw new Error(
		`registry 查询失败 ${name}（重试 3 次）: ${message}`,
	);
}

/** 并行（限流 8）查询全部包的 registry 版本集（包名 → 已发布版本集合）。 */
export async function fetchAllPublished(
	pkgs: readonly PkgInfo[],
	prefix: string,
): Promise<Map<string, Set<string>>> {
	console.log(
		`${prefix} 🔍 正在比对 registry 已发布版本（${pkgs.length} 个包）…`,
	);
	const startedAt = Date.now();
	const map = new Map<string, Set<string>>();
	await runPool(pkgs, 8, async (pkg) => {
		map.set(
			pkg.name,
			await fetchPublishedVersions(pkg.name),
		);
	});
	console.log(
		`${prefix} ✅ 比对完成（${((Date.now() - startedAt) / 1000).toFixed(1)}s）`,
	);
	return map;
}

/** registry 可达性探测（5s 单次；5xx 也算可达，是源站问题不是网络问题）。 */
export async function probeRegistry(): Promise<boolean> {
	try {
		const res = await fetch(REGISTRY, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(5_000),
		});
		return res.status < 500;
	} catch {
		return false;
	}
}

/** npm 当前登录名（未登录 / 查询失败 → null）。 */
export function npmWhoami(cwd: string): string | null {
	return captureNpm(["whoami"], cwd) || null;
}

/** 查询包 owner 用户名列表（查询失败视为空集）。 */
export function npmOwners(
	cwd: string,
	name: string,
): string[] {
	const raw = captureNpm(
		["owner", "ls", "--json", name],
		cwd,
	);
	if (raw === null || raw === "") return [];
	if (raw.startsWith("[")) {
		try {
			const list = JSON.parse(raw) as { name?: unknown }[];
			return Array.isArray(list)
				? list
						.map((item) =>
							typeof item.name === "string"
								? item.name
								: "",
						)
						.filter(Boolean)
				: [];
		} catch {
			return [];
		}
	}
	// npm 11 的 owner ls 忽略 --json 输出人读格式（user <email>），按行取首段
	return raw
		.split("\n")
		.map((line) => line.trim().split(/\s+/)[0] ?? "")
		.filter(
			(owner) => owner !== "" && !owner.startsWith("<"),
		);
}
