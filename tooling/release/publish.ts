// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/** publish 环：registry 比对、所有权预检、拓扑序逐包 npm publish。 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Options } from "./options.ts";
import { ROOT } from "./options.ts";
import { runNpm } from "./proc.ts";
import {
	npmOwners,
	npmWhoami,
	probeRegistry,
	REGISTRY,
} from "./registry.ts";
import {
	fetchAllPublished,
	filterDowngrades,
} from "./shared.ts";
import type { PkgInfo } from "./workspace.ts";
import {
	discoverPackages,
	planPublish,
	rewriteWorkspaceProtocol,
	topoSort,
} from "./workspace.ts";

/**
 * 发布失败后的排查提示。
 *
 * 高频且易被误判为「网络 / 权限问题」的是 E409：`Cannot publish
 * over previously staged version "<version>"`——该版本已进入 npm
 * 暂存区（staged publish）等待人工批准；暂存版本不在 registry 的
 * versions 列表里，发布链的比对无从感知，重跑只会再次撞 409。
 * 处置：npmjs.com 的 Staged Packages 标签页 Approve（转为正式
 * 发布）或 Reject（丢弃后重发），或用 npm ≥ 11.15 的
 * `npm stage list` / `npm stage approve|reject`。
 */
function printPublishFailureHints(pkg: PkgInfo): void {
	console.log(
		"[publish] 💡 若上方报错为 E409「Cannot publish over previously staged version」：",
	);
	console.log(
		"[publish]    该版本已进入 npm 暂存区（staged publish）等待批准；暂存版本不在 registry 的 versions 列表内，比对无法感知，重跑必然再次 409。",
	);
	console.log(
		`[publish]    处置：到 npmjs.com 的 Staged Packages 标签页对 ${pkg.name}@${pkg.version} 执行 Approve（转为正式发布）或 Reject（丢弃后重发）；npm ≥ 11.15 可用 npm stage list / npm stage approve|reject。`,
	);
	console.log(
		"[publish]    同批其余未发布包可先用 --only <包名> 单独补发。",
	);
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
	// --only：精确发布名单（补发漏发 / 重发坏版本）；名单外的待发布包
	// 记入 skipped 本次不动。名单内拼写错误早报，避免静默漏发。
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
		const kept: PkgInfo[] = [];
		for (const pkg of toPublish) {
			if (only.has(pkg.name)) {
				kept.push(pkg);
			} else {
				plan.skipped.push({
					pkg,
					reason: "不在 --only 名单内",
				});
			}
		}
		toPublish.length = 0;
		toPublish.push(...kept);
	}
	// 所有权预检：别人的包（版本领先于 registry 的第三方插件）跳过而非 403 中断；
	// 首发包不做预检（首个发布者自动成为 owner）
	if (!options.dryRun) {
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
	if (plan.skipped.length > 0) {
		console.log(
			`[publish] 跳过 ${plan.skipped.length} 个：`,
		);
		for (const { pkg, reason } of plan.skipped) {
			console.log(
				`  ⏭  ${pkg.name}@${pkg.version}（${reason}）`,
			);
		}
	}
	if (toPublish.length === 0) {
		console.log("[publish] 无需发布");
		return 0;
	}
	const ordered = topoSort(toPublish);
	console.log(
		`[publish] 发布序（${ordered.length} 个${options.dryRun ? "，dry-run" : ""}）：`,
	);
	for (const pkg of ordered) {
		console.log(`  ${pkg.name}@${pkg.version}`);
	}
	if (options.dryRun) {
		console.log("[publish] [dry-run] 未执行发布");
		return 0;
	}
	// 逐包发布：发布前把 workspace:* 改写为 caret 真实版本（npm 不认该协议），
	// finally 还原原文件（不落盘，工作区保持洁净）
	const versions = new Map(
		pkgs.map((pkg) => [pkg.name, pkg.version]),
	);
	for (const pkg of ordered) {
		const original = readFileSync(pkg.manifestPath, "utf8");
		const { text, changes } = rewriteWorkspaceProtocol(
			original,
			versions,
		);
		if (changes.length > 0) {
			writeFileSync(pkg.manifestPath, text, "utf8");
			console.log(
				`[publish] ✍️  ${pkg.name}: workspace:* → ${changes.map((c) => `${c.dep}@${c.range}`).join(", ")}`,
			);
		}
		try {
			// stdin 直通终端：npm 的 OTP 浏览器认证要求 stdin/stdout 双 TTY，
			// 断开 stdin 会直接抛 EOTP（逐包弹浏览器逐包认证，属预期流程）
			const code = await runNpm(
				["publish", "--access", "public"],
				pkg.dir,
				{
					stdin: "inherit",
				},
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
