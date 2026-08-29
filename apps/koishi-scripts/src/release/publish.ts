/**
 * `koishi-scripts publish`：npm 逐个发布 CLI（发布链最后一环）。
 *
 * 用法：
 *   koishi-scripts publish            # 拓扑序逐个 npm publish --access public
 *   koishi-scripts publish --dry-run  # 只跑 npm publish --dry-run（打包检查，不发布）
 *
 * 前置（发布链顺序保证）：
 *   1. koishi-scripts version —— 各有 pending changeset 的项目已升版本
 *   2. koishi-scripts build —— 各包 lib 已构建
 *
 * 行为：
 *   - 发布前查询 registry：本地版本已存在（changeset 未 bump 的包）→ 跳过
 *   - 本地版本低于 registry 已发布版本（源码落后）→ 跳过并警告
 *   - **所有权预检**：对 registry 已有版本的待发包查 `npm owner ls`，当前
 *     登录者不是 owner → 跳过而非发布失败——避免 clone 进来的第三方插件
 *     （版本领先时）因 npm 403 中断整条发布链；首次发布（registry 无版本）
 *     不做预检，首个发布者自动成为 owner
 *   - 仅对需要发布的包做拓扑排序（被依赖者在前）并逐个 npm publish
 *   - 任一包失败 → 立即中断，退出码非 0（避免后续包依赖残缺上游）
 *   - workspace:* 改写：发布前把每个包 package.json 中 workspace:* 依赖
 *     改写为 caret 真实版本，发布后恢复原样（幂等兜底）
 *
 * registry 查询直连 registry.npmjs.org 在部分网络环境下不稳定，带 15s
 * 超时 + 3 次退避重试（RELEASE_REGISTRY 环境变量可切换查询源）。
 * 纯逻辑在 ./publish-core（可单测），本文件只做参数解析 + 进程执行。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "../index";
import type { WorkspacePkg } from "./publish-core";
import {
	discoverPackages,
	isDowngrade,
	planPublish,
	rewriteWorkspaceProtocol,
	topoSort,
} from "./publish-core";
import { captureCommand, runCommand } from "./run";

const REGISTRY =
	process.env["RELEASE_REGISTRY"] ?? "https://registry.npmjs.org";

/** 查询单个 npm 包在 registry 的所有已发布版本。404 → 空集；其他非 200 → 抛错。 */
async function fetchPublishedVersions(pkgName: string): Promise<Set<string>> {
	const url = `${REGISTRY}/${pkgName.replaceAll("/", "%2F")}`;
	let lastError: unknown = new Error("unreachable");
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const res = await fetch(url, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(15_000),
			});
			if (res.status === 404) {
				return new Set();
			}
			if (!res.ok) {
				throw new Error(`registry 查询失败 ${pkgName}: HTTP ${res.status}`);
			}
			const json = (await res.json()) as { versions?: Record<string, unknown> };
			return new Set(Object.keys(json["versions"] ?? {}));
		} catch (err) {
			lastError = err;
			if (attempt < 3) {
				await new Promise((r) => setTimeout(r, attempt * 2000));
			}
		}
	}
	const message =
		lastError instanceof Error ? lastError.message : String(lastError);
	throw new Error(`registry 查询失败 ${pkgName}（重试 3 次）: ${message}`);
}

/** 查询 npm 当前登录账号（未登录返回 null）。 */
function fetchWhoami(): string | null {
	return captureCommand(cwd, "npm", ["whoami"]);
}

/** 查询包的 owner 用户名列表（查询失败视为空集）。 */
function fetchOwners(pkgName: string): string[] {
	const raw = captureCommand(cwd, "npm", ["owner", "ls", "--json", pkgName]);
	if (raw === null) {
		return [];
	}
	try {
		const list = JSON.parse(raw) as { name?: unknown }[];
		if (!Array.isArray(list)) {
			return [];
		}
		return list
			.map((item) => (typeof item.name === "string" ? item.name : ""))
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * 所有权预检：过滤掉当前 npm 登录者不拥有所有权的包（别人的包，发布必 403）。
 * 返回 { publishable, skipped }；whoami 不可得时跳过预检（发布由 npm 鉴权兜底）。
 */
function filterByOwnership(
	publishable: readonly WorkspacePkg[],
	published: ReadonlyMap<string, ReadonlySet<string>>,
	whoami: string | null,
): {
	publishable: WorkspacePkg[];
	skipped: { pkg: WorkspacePkg; reason: string }[];
} {
	if (whoami === null) {
		process.stderr.write(
			"[publish] ⚠️  未获取到 npm 登录身份（npm whoami），跳过所有权预检（无权限时 npm 会拒绝发布）\n",
		);
		return { publishable: [...publishable], skipped: [] };
	}
	const kept: WorkspacePkg[] = [];
	const skipped: { pkg: WorkspacePkg; reason: string }[] = [];
	for (const pkg of publishable) {
		// registry 无版本 = 首次发布，无预检意义（首个发布者自动成为 owner）
		if ((published.get(pkg.name)?.size ?? 0) === 0) {
			kept.push(pkg);
			continue;
		}
		const owners = fetchOwners(pkg.name);
		if (!owners.includes(whoami)) {
			skipped.push({
				pkg,
				reason: `当前账号 ${whoami} 不是 owner（owner: ${owners.join(", ") || "未知"}），疑似他人插件`,
			});
			continue;
		}
		kept.push(pkg);
	}
	return { publishable: kept, skipped };
}

/**
 * 按拓扑序逐个发布（publish 前改写 workspace:* → 真实版本，finally 恢复原样）。
 * 任一包失败 → 返回非 0（后续包依赖残缺上游，立即中断）。
 */
async function publishOrdered(
	ordered: readonly WorkspacePkg[],
	workspaceVersions: ReadonlyMap<string, string>,
	dryRun: boolean,
): Promise<number> {
	for (const pkg of ordered) {
		const manifestPath = join(pkg.dir, "package.json");
		const original = readFileSync(manifestPath, "utf8");
		const { text, changes } = rewriteWorkspaceProtocol(
			original,
			workspaceVersions,
		);
		if (changes.length > 0) {
			writeFileSync(manifestPath, text, "utf8");
			console.log(
				`[publish] ✍️  ${pkg.name}: workspace:* → 真实版本 ${changes
					.map((c) => `${c.dep}@${c.range}`)
					.join(", ")}`,
			);
		}
		try {
			const args = [
				"publish",
				"--access",
				"public",
				...(dryRun ? ["--dry-run"] : []),
			];
			const code = runCommand(pkg.dir, "npm", args);
			if (code !== 0) {
				console.log(
					`[publish] ❌ 发布失败: ${pkg.name}@${pkg.version}（退出码 ${code}），已中断`,
				);
				return code;
			}
			console.log(
				`[publish] ✅ ${dryRun ? "dry-run 通过" : "已发布"}: ${pkg.name}@${pkg.version}`,
			);
		} finally {
			if (changes.length > 0) {
				writeFileSync(manifestPath, original, "utf8");
				console.log(
					`[publish] ↩ 已恢复 ${pkg.name}/package.json（workspace:*）`,
				);
			}
		}
	}
	console.log(`[publish] 全部完成（${dryRun ? "dry-run" : "已发布"}）`);
	return 0;
}

/** 主流程：发现 → 查 registry → 过滤已发布/降级/无所有权 → 拓扑排序 → 逐个发布。 */
export default async function runPublish(
	args: readonly string[],
): Promise<number> {
	const dryRun = args.includes("--dry-run");
	const pkgs = await discoverPackages(cwd);
	if (pkgs.length === 0) {
		console.log("[publish] 未发现任何可发布包");
		return 0;
	}

	// 发布前查询 registry，只发布版本有变化的包（changeset 未 bump 的跳过）
	const published = new Map<string, Set<string>>();
	await Promise.all(
		pkgs.map(async (pkg) => {
			published.set(pkg.name, await fetchPublishedVersions(pkg.name));
		}),
	);
	const { toPublish, skipped } = planPublish(pkgs, published);

	// 本地版本低于 registry 已发布版本（源码落后于已发布）→ 跳过并警告
	const downgraded = toPublish.filter((pkg) =>
		isDowngrade(pkg.version, published.get(pkg.name) ?? new Set<string>()),
	);
	let publishable = toPublish.filter((pkg) => !downgraded.includes(pkg));
	for (const pkg of downgraded) {
		skipped.push({
			pkg,
			reason:
				"本地版本低于 registry 已发布版本（本地源码落后，请先同步或用 changeset 升到更高版本）",
		});
	}

	// 所有权预检：别人的包（版本领先于 registry 的第三方插件）跳过而非 403 中断
	const whoami = dryRun ? null : fetchWhoami();
	const ownership = filterByOwnership(publishable, published, whoami);
	publishable = ownership.publishable;
	skipped.push(...ownership.skipped);

	if (skipped.length > 0) {
		console.log(`[publish] 跳过（${skipped.length} 个）:`);
		for (const item of skipped) {
			console.log(
				`  ⏭  ${item.pkg.name}@${item.pkg.version}（${item.reason}）`,
			);
		}
	}
	if (publishable.length === 0) {
		console.log("[publish] 无需发布，全部包已被跳过");
		return 0;
	}

	const ordered = topoSort(publishable);
	console.log(
		`[publish] 发布顺序（${ordered.length} 个包，${dryRun ? "dry-run" : "publish"}）:`,
	);
	for (const pkg of ordered) {
		console.log(`  ${pkg.name}@${pkg.version}`);
	}
	// workspace:* → caret 真实版本映射（按工作区当前版本，改写在 publish 前、恢复在 finally）
	const workspaceVersions = new Map(pkgs.map((pkg) => [pkg.name, pkg.version]));
	return await publishOrdered(ordered, workspaceVersions, dryRun);
}
