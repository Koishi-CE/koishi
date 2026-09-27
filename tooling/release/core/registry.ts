// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * npm registry / npm CLI 查询层。
 *
 * registry 直连在部分网络环境不稳定：15s 超时 + 3 次退避重试；404 视为
 * 首次发布（空集）。RELEASE_REGISTRY 环境变量可切换查询源；tarball 发布
 * 始终走 npm CLI 当前配置，与本查询源解耦。
 */
import { captureNpm } from "./proc.ts";

/** registry 查询源（可用 RELEASE_REGISTRY 环境变量覆盖）。 */
export const REGISTRY =
	process.env["RELEASE_REGISTRY"] ??
	"https://registry.npmjs.org";

/**
 * 是否处于 OIDC 可信发布环境（能换到 npm 发布 token 的 Actions 运行）。
 *
 * 判定依据 `ACTIONS_ID_TOKEN_REQUEST_URL`：GitHub 只在 workflow 的 job 显式
 * 声明 `permissions: id-token: write` 时才注入它，因此它是「本次运行有权换
 * OIDC token」的充分必要条件。不用 GITHUB_ACTIONS——任何 Actions 运行都为真，
 * 与「能否免 token 发布」无关。
 *
 * 该模式下没有 npm 登录态：npm CLI 在 publish 时用 GitHub 的 id_token 换一个
 * **包级**短时 token（npm/lib/utils/oidc.js 的 `/-/npm/v1/oidc/token/exchange/
 * package/<包名>`），因此 `npm whoami` / `npm owner ls` 必然失败，依赖登录态的
 * 预检必须跳过。
 */
export function isOidcTrustedPublishing(): boolean {
	const url = process.env["ACTIONS_ID_TOKEN_REQUEST_URL"];
	return typeof url === "string" && url !== "";
}

/** 查询单包全部已发布版本；404 → 空集（首发），其余失败重试 3 次后抛错。 */
export async function fetchPublishedVersions(
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
			if (res.status === 404) {
				return new Set();
			}
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
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

/** registry 可达性探测（5s 超时单次；5xx 也算可达，是源站问题不是网络问题）。 */
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
	// npm 11 的 owner ls 忽略 --json 输出人读格式（user <email>），但保留
	// 旗标：未来版本若恢复 JSON 输出走 JSON 分支，否则按行取首个空白段
	const raw = captureNpm(
		["owner", "ls", "--json", name],
		cwd,
	);
	if (raw === null || raw === "") {
		return [];
	}
	if (raw.startsWith("[")) {
		try {
			const list = JSON.parse(raw) as { name?: unknown }[];
			if (!Array.isArray(list)) {
				return [];
			}
			return list
				.map((item) =>
					typeof item.name === "string" ? item.name : "",
				)
				.filter(Boolean);
		} catch {
			return [];
		}
	}
	return raw
		.split("\n")
		.map((line) => line.trim().split(/\s+/)[0] ?? "")
		.filter((name) => name !== "" && !name.startsWith("<"));
}
