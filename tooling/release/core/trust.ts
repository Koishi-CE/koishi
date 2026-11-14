// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// npm 可信发布（OIDC）信任配置探测层。信任配置是逐包的（repository +
// workflow 文件 + environment 三项 claim 与包记录精确相符），且新建配置须
// 在 2 天内完成首次发布否则失效不可编辑。registry 对「没配 / claim 不符 /
// 已过期」一律回 404 package not found，npm CLI 只在 verbose 日志里记一句
// 后静默退回无凭证发布——本模块复刻 npm CLI 的换 token 请求：换到＝配置
// 可用；404＝当前没有可用配置；其余状态是探测本身的问题，不据此拦截发布。
// 探测只换 token、不发布，换到的 token 用完即弃，绝不落日志。
import { REGISTRY } from "./registry.ts";
import { runPool } from "./utils.ts";

const REQUEST_TIMEOUT_MS = 15_000;

/** 单包探测结论（detail 供人读，不含任何凭证）。 */
export interface TrustProbeResult {
	name: string;
	status: "ok" | "missing" | "error";
	detail: string;
}

/**
 * fetch 的窄化调用面（真实 fetch 可赋值）。不用 `typeof fetch`：Bun 全局
 * fetch 挂了非标准的 `fetch.preconnect()` 扩展（bun-types globals.d.ts，
 * 函数 + 命名空间合并），裸函数 fake 断言成 `typeof fetch` 必然缺该成员。
 */
export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

/** 某包的 OIDC 换 token 端点（包名转路径段：@scope/name → @scope%2Fname）。 */
export function exchangeUrl(name: string): string {
	return `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${name.replaceAll("/", "%2F")}`;
}

/** 取 Actions 的 id_token（audience 与 npm CLI 一致：npm:<registry 主机名>）。 */
export async function fetchGithubIdToken(
	fetchImpl: FetchLike = fetch,
): Promise<string> {
	const requestUrl =
		process.env["ACTIONS_ID_TOKEN_REQUEST_URL"];
	const requestToken =
		process.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"];
	if (!requestUrl || !requestToken) {
		throw new Error(
			"缺少 ACTIONS_ID_TOKEN_REQUEST_URL / ACTIONS_ID_TOKEN_REQUEST_TOKEN（job 未声明 id-token: write）",
		);
	}
	const endpoint = new URL(requestUrl);
	endpoint.searchParams.append(
		"audience",
		`npm:${new URL(REGISTRY).hostname}`,
	);
	const res = await fetchImpl(endpoint, {
		headers: {
			accept: "application/json",
			authorization: `Bearer ${requestToken}`,
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(
			`GitHub id_token 请求失败：HTTP ${res.status}`,
		);
	}
	const json = (await res.json()) as { value?: unknown };
	if (typeof json.value !== "string" || json.value === "") {
		throw new Error("GitHub id_token 响应缺少 value");
	}
	return json.value;
}

/** 从 registry 的错误响应里取 message（拿不到就退回空串）。 */
async function readErrorMessage(
	res: Response,
): Promise<string> {
	try {
		const json = JSON.parse(await res.text()) as {
			message?: unknown;
		};
		return typeof json.message === "string"
			? json.message
			: "";
	} catch {
		return "";
	}
}

/** 探测单包能否换到发布 token（404 → missing；其余失败 → error，不抛）。 */
export async function probePackageTrust(
	idToken: string,
	name: string,
	fetchImpl: FetchLike = fetch,
): Promise<TrustProbeResult> {
	let res: Response;
	try {
		res = await fetchImpl(exchangeUrl(name), {
			method: "POST",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${idToken}`,
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (err) {
		const message =
			err instanceof Error ? err.message : String(err);
		return {
			name,
			status: "error",
			detail: `请求异常：${message}`,
		};
	}
	if (res.ok) {
		try {
			const json = (await res.json()) as {
				token?: unknown;
			};
			if (
				typeof json.token === "string" &&
				json.token !== ""
			) {
				return {
					name,
					status: "ok",
					detail: "已换到 token",
				};
			}
			return {
				name,
				status: "error",
				detail: "交换响应缺少 token",
			};
		} catch {
			return {
				name,
				status: "error",
				detail: "交换响应无法解析",
			};
		}
	}
	const message = await readErrorMessage(res);
	if (res.status === 404) {
		return {
			name,
			status: "missing",
			detail: message || "HTTP 404",
		};
	}
	return {
		name,
		status: "error",
		detail: `HTTP ${res.status}${message ? `（${message}）` : ""}`,
	};
}

/** 并发探测一批包（限流 4，保持输入顺序输出）。 */
export async function probeTrustConfigs(
	idToken: string,
	names: readonly string[],
	fetchImpl: FetchLike = fetch,
): Promise<TrustProbeResult[]> {
	const results = new Map<string, TrustProbeResult>();
	await runPool(names, 4, async (name) => {
		results.set(
			name,
			await probePackageTrust(idToken, name, fetchImpl),
		);
	});
	return names.flatMap((name) => results.get(name) ?? []);
}
