// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

// publish 环：registry 比对 → 所有权预检 → OIDC 信任预检 → 拓扑序逐包
// npm publish。发布前把 workspace:* / catalog: 改写为真实版本，finally 还原
// package.json（不落盘，工作区保持洁净）。
import { readFileSync, writeFileSync } from "node:fs";
import { runNpm } from "../../shared/exec.ts";
import { readCatalogSpecs } from "../../shared/workspace.ts";
import type { Options } from "../core/options.ts";
import { ROOT } from "../core/options.ts";
import {
	fetchAllPublished,
	isOidcTrustedPublishing,
	npmOwners,
	npmWhoami,
	probeRegistry,
	REGISTRY,
} from "../core/registry.ts";
import type {
	FetchLike,
	TrustProbeResult,
} from "../core/trust.ts";
import {
	fetchGithubIdToken,
	probeTrustConfigs,
} from "../core/trust.ts";
import type { PkgInfo } from "../core/workspace.ts";
import {
	discoverPackages,
	filterDowngrades,
	planPublish,
	rewriteWorkspaceProtocol,
	topoSort,
} from "../core/workspace.ts";

/**
 * 发布失败后的排查提示（两类高频误判，原因与处置各一行）：E409 = 版本已进
 * npm 暂存区等人工批准（暂存版本不在 registry versions 列表里，重跑必再
 * 409）；ENEEDAUTH = npm 换 OIDC 包级 token 失败后静默退回无凭证发布，
 * 非「没登录」，真正原因只在 verbose 日志里（CI 发布步骤已开
 * NPM_CONFIG_LOGLEVEL=verbose）。
 */
function printPublishFailureHints(pkg: PkgInfo): void {
	console.log(`[publish] 💡 E409 staged publish：${pkg.name}@${pkg.version} 已进 npm 暂存区等待批准；到 npmjs.com 的 Staged Packages 标签页 Approve（转正式发布）或 Reject（丢弃重发），其余包可 --only 补发。
[publish] 💡 ENEEDAUTH：npm 换 OIDC 包级 token 失败后静默退回无凭证发布，非「没登录」；verbose 日志见「OIDC token exchange error - package not found」即该包缺信任配置（没配 / claim 与 release.yml 不符 / 超 2 天未完成首发已过期，三者同码）。先 npm login 再执行：
[publish]    npm trust github ${pkg.name} --file release.yml --repo Koishi-CE/koishi --environment release --allow-publish（已有配置只能 revoke 后重建）`);
}

/**
 * OIDC 信任配置预检（只在 OIDC 模式跑）：发布前逐包换一次发布 token，换不
 * 到就一个包都不发——否则半批已推上 npm，且每轮发布只撞出一个缺口。首发包
 * 不参与预检：包在 registry 不存在就无从创建配置，换 token 必然 404。
 */
export async function preflightTrustConfigs(
	ordered: readonly PkgInfo[],
	published: Map<string, Set<string>>,
	prefix: string,
	fetchImpl: FetchLike = fetch,
): Promise<boolean> {
	const hasVersions = (pkg: PkgInfo): boolean =>
		(published.get(pkg.name)?.size ?? 0) > 0;
	const existing = ordered.filter(hasVersions);
	const fresh = ordered.filter((pkg) => !hasVersions(pkg));
	if (fresh.length > 0) {
		console.log(
			`${prefix} ℹ️ 首发包不参与预检（registry 无任何版本）：${fresh.map((pkg) => pkg.name).join(", ")}`,
		);
	}
	if (existing.length === 0) return false;
	let idToken: string;
	try {
		idToken = await fetchGithubIdToken(fetchImpl);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : String(err);
		console.log(
			`${prefix} ⚠️ 跳过信任配置预检（${message}）——发布继续，缺配置的包仍会在 npm publish 处失败`,
		);
		return false;
	}
	console.log(
		`${prefix} 🔐 预检 OIDC 信任配置（${existing.length} 个包）…`,
	);
	const results = await probeTrustConfigs(
		idToken,
		existing.map((pkg) => pkg.name),
		fetchImpl,
	);
	const byName = new Map(
		results.map((result) => [result.name, result]),
	);
	const missing: PkgInfo[] = [];
	const uncertain: TrustProbeResult[] = [];
	for (const pkg of existing) {
		const result = byName.get(pkg.name);
		if (result?.status === "missing") {
			missing.push(pkg);
		} else if (result?.status === "error") {
			uncertain.push(result);
		}
	}
	for (const result of uncertain) {
		console.log(
			`${prefix} ⚠️ 探测不确定 ${result.name}：${result.detail}（不据此拦截）`,
		);
	}
	if (missing.length === 0) {
		const ok = existing.length - uncertain.length;
		console.log(
			`${prefix} ✅ 预检通过：${ok} 个可用${uncertain.length > 0 ? `，${uncertain.length} 个探测不确定（不拦截）` : ""}`,
		);
		return false;
	}
	const listed = missing
		.map((pkg) => `  ⛔ ${pkg.name}@${pkg.version}`)
		.join("\n");
	console.log(`${prefix} ❌ ${missing.length} 个包没有可用的 OIDC 信任配置，本次一个包都不发：
${listed}
${prefix} 💡 404「package not found」＝没配 / claim 与 release.yml 不符 / 超 2 天未完成首发已过期。处置（本机 npm login）：npm trust list <包名> → 有旧记录先 revoke → npm trust github <包名> --file release.yml --repo Koishi-CE/koishi --environment release --allow-publish --yes
${prefix} ⏳ 新配置须 2 天内完成首次发布：配完立刻重跑本链并批准。只补本批是刻意的——提前配好的包两天后照样过期。`);
	return true;
}

/** publish 环：registry 比对 → 所有权预检 → 拓扑序逐包发布。 */
export async function runPublishSteps(
	options: Options,
): Promise<number> {
	const pkgs = discoverPackages(ROOT);
	if (!(await probeRegistry())) {
		process.stderr.write(
			`[publish] ❌ registry 不可达（${REGISTRY}），无法比对版本\n`,
		);
		return 1;
	}
	const published = await fetchAllPublished(
		pkgs,
		"[publish]",
	);
	const plan = planPublish(pkgs, published);
	const { toPublish, downgraded } = filterDowngrades(
		plan,
		published,
	);
	for (const pkg of downgraded) {
		plan.skipped.push({
			pkg,
			reason:
				"本地版本低于 registry 已发布版本（源码落后，先同步源码）",
		});
	}
	// --only：精确发布名单（补发漏发 / 重发坏版本）；名单外记入 skipped，
	// 名单内拼写错误早报，避免静默漏发。
	if (options.only.length > 0) {
		const known = new Set(pkgs.map((pkg) => pkg.name));
		const unknown = options.only.filter(
			(name) => !known.has(name),
		);
		if (unknown.length > 0) {
			process.stderr.write(
				`[publish] ❌ --only 含未知包名：${unknown.join(", ")}\n`,
			);
			return 1;
		}
		const only = new Set(options.only);
		const kept = toPublish.filter((pkg) =>
			only.has(pkg.name),
		);
		for (const pkg of toPublish) {
			if (!only.has(pkg.name)) {
				plan.skipped.push({
					pkg,
					reason: "不在 --only 名单内",
				});
			}
		}
		toPublish.length = 0;
		toPublish.push(...kept);
	}
	// 所有权预检：别人的包（版本领先于 registry 的第三方插件）跳过而非 403
	// 中断；首发包不做预检（首个发布者自动成为 owner）。OIDC 下跳过整个预检
	// ——没有登录态，whoami 必然 E401、owner ls 只会拿到空集，空集会把本仓
	// 已发布过的包全部静默判成他人插件（＝什么都没发）。跳过是安全的：本仓
	// workspaces 只含自有目录，不存在需要靠 owner 查询甄别的第三方包。
	if (!options.dryRun) {
		if (isOidcTrustedPublishing()) {
			console.log(
				"[publish] 🔐 OIDC 可信发布模式（id-token: write），跳过 npm 登录与所有权预检",
			);
		} else {
			const whoami = npmWhoami(ROOT);
			if (whoami === null) {
				process.stderr.write(
					"[publish] ❌ 未获取到 npm 登录身份（先 npm login）\n",
				);
				return 1;
			}
			const kept: PkgInfo[] = [];
			for (const pkg of toPublish) {
				if ((published.get(pkg.name)?.size ?? 0) === 0) {
					kept.push(pkg);
					continue;
				}
				const owners = npmOwners(ROOT, pkg.name);
				if (!owners.includes(whoami)) {
					plan.skipped.push({
						pkg,
						reason: `当前账号 ${whoami} 不是 owner（${owners.join(", ") || "未知"}），疑似他人插件`,
					});
				} else {
					kept.push(pkg);
				}
			}
			toPublish.length = 0;
			toPublish.push(...kept);
		}
	}
	if (plan.skipped.length > 0) {
		const listed = plan.skipped
			.map(
				({ pkg, reason }) =>
					`  ⏭  ${pkg.name}@${pkg.version}（${reason}）`,
			)
			.join("\n");
		console.log(
			`[publish] 跳过 ${plan.skipped.length} 个：\n${listed}`,
		);
	}
	if (toPublish.length === 0) {
		console.log("[publish] 无需发布");
		return 0;
	}
	const ordered = topoSort(toPublish);
	const order = ordered
		.map((pkg) => `  ${pkg.name}@${pkg.version}`)
		.join("\n");
	console.log(
		`[publish] 发布序（${ordered.length} 个${options.dryRun ? "，dry-run" : ""}）：\n${order}`,
	);
	if (options.dryRun) {
		console.log("[publish] [dry-run] 未执行发布");
		return 0;
	}
	// OIDC 预检：逐包换一次 token，缺配置就整批不发（见 preflightTrustConfigs）
	if (
		isOidcTrustedPublishing() &&
		(await preflightTrustConfigs(
			ordered,
			published,
			"[publish]",
		))
	) {
		return 1;
	}
	const versions = new Map(
		pkgs.map((pkg) => [pkg.name, pkg.version]),
	);
	const catalogs = readCatalogSpecs(ROOT);
	for (const pkg of ordered) {
		const original = readFileSync(pkg.manifestPath, "utf8");
		const { text, changes } = rewriteWorkspaceProtocol(
			original,
			versions,
			catalogs,
		);
		if (changes.length > 0) {
			writeFileSync(pkg.manifestPath, text, "utf8");
			console.log(
				`[publish] ✍️  ${pkg.name}: 协议改写 → ${changes.map((c) => `${c.dep}@${c.range}`).join(", ")}`,
			);
		}
		try {
			// stdin 直通终端：本地发布走 npm 的 OTP 浏览器认证，要求 stdin/stdout
			// 双 TTY，断开 stdin 会直接抛 EOTP（逐包弹浏览器属预期流程）。OIDC
			// 模式下不需要 OTP，inherit 在 runner 上无害，保留以免两条路径分叉。
			const code = await runNpm(
				["publish", "--access", "public"],
				pkg.dir,
				"inherit",
			);
			if (code !== 0) {
				console.log(
					`[publish] ❌ 发布失败 ${pkg.name}@${pkg.version}（退出码 ${code}），已中断`,
				);
				printPublishFailureHints(pkg);
				return code;
			}
			console.log(
				`[publish] ✅ 已发布 ${pkg.name}@${pkg.version}`,
			);
		} finally {
			if (changes.length > 0) {
				writeFileSync(pkg.manifestPath, original, "utf8");
			}
		}
	}
	console.log("[publish] 全部完成");
	return 0;
}
