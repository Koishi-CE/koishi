#!/usr/bin/env bun
/**
 * Koishi-CE monorepo 构建发布一条龙（零第三方依赖，Bun 运行时）。
 *
 * 面向本仓库 workspace 自身的全部可发布包；与 apps/koishi-scripts 的
 * release 链（面向宿主工作区 external/* 插件项目）互不相干。版本由
 * changesets 管理（.changeset/config.json），本工具编排发布链：
 *
 *   status    概览：pending changeset、本地版本 vs registry、发布序
 *   version   消费 .changeset/ 条目（changeset version）+ bun install 刷新 lockfile
 *   build     根 tsdown → 宿主控制台总装（console/dist）→ 各 webui 插件前端 dist
 *   publish   registry 比对 → 所有权预检 → 拓扑序逐包 npm publish（workspace:* 改写）
 *   pipeline  一条龙：preflight → version → 提交 → build → test → publish → push
 *
 * 设计取向（同 qq-releases / koishi-scripts 工具先例）：任何一步失败立即
 * 中断并保留现场；重跑幂等（已发布版本经 registry 比对自动跳过）；
 * --dry-run 只打印计划不落盘。webui 插件 dist 不入 git，发布前必须现
 * 构建——build 环遗漏任一插件都会导致发布缺前端，故 targets 由 files
 * 字段自动推导而非手工列举。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capture, run, runNpm } from "./proc";
import {
	fetchPublishedVersions,
	npmOwners,
	npmWhoami,
	probeRegistry,
	REGISTRY,
} from "./registry";
import type { PkgInfo } from "./workspace";
import {
	countPendingChangesets,
	discoverPackages,
	isDowngrade,
	planPublish,
	rewriteWorkspaceProtocol,
	topoSort,
} from "./workspace";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** webui 插件前端的并发构建数（vite 单构建内存可观，不宜拉满）。 */
const BUILD_CONCURRENCY = 4;

/** CLI 旗标集。 */
interface Options {
	dryRun: boolean;
	push: boolean;
	allowDirty: boolean;
	skipBuild: boolean;
	skipTest: boolean;
}

const HELP = `Koishi-CE 发布工具链（tooling/release）

用法：bun run release <命令> [旗标]

命令：
  status            概览：pending changeset、本地版本 vs registry、发布序
  version           消费 .changeset/ 条目（changeset version + bun install）
  build             根 tsdown + 宿主控制台总装 + 各 webui 插件前端 dist
  publish           registry 比对 → 所有权预检 → 拓扑序逐包 npm publish
  pipeline          一条龙：preflight → version → 提交 → build → test → publish

旗标：
  --dry-run         只看计划，不做任何变更
  --push            pipeline 末尾推送 main
  --allow-dirty     跳过工作区洁净检查（版本提交仍只含版本相关文件）
  --skip-build      pipeline 跳过构建环
  --skip-test       pipeline 跳过测试环
  -h, --help        显示本帮助

环境变量：RELEASE_REGISTRY 可切换 registry 查询源（默认 registry.npmjs.org）。`;

/** 解析旗标；遇到未知旗标返回 null。 */
function parseOptions(args: readonly string[]): Options | null {
	const options: Options = {
		dryRun: false,
		push: false,
		allowDirty: false,
		skipBuild: false,
		skipTest: false,
	};
	for (const arg of args) {
		switch (arg) {
			case "--dry-run": {
				options.dryRun = true;
				break;
			}
			case "--push": {
				options.push = true;
				break;
			}
			case "--allow-dirty": {
				options.allowDirty = true;
				break;
			}
			case "--skip-build": {
				options.skipBuild = true;
				break;
			}
			case "--skip-test": {
				options.skipTest = true;
				break;
			}
			default: {
				return null;
			}
		}
	}
	return options;
}

/** 并行查询全部包的 registry 版本集（包名 → 已发布版本集合）。 */
async function fetchAllPublished(
	pkgs: readonly PkgInfo[],
): Promise<Map<string, Set<string>>> {
	const map = new Map<string, Set<string>>();
	await Promise.all(
		pkgs.map(async (pkg) => {
			map.set(pkg.name, await fetchPublishedVersions(pkg.name));
		}),
	);
	return map;
}

/** 有界并发池：失败即停止调度新任务，等在跑任务收尾后抛出首个错误。 */
async function runPool<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	let failed = false;
	let firstError: unknown;
	async function lane(): Promise<void> {
		while (!failed) {
			const item = items[next];
			next += 1;
			if (item === undefined) {
				return;
			}
			try {
				await worker(item);
			} catch (err) {
				if (!failed) {
					failed = true;
					firstError = err;
				}
				return;
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => lane()),
	);
	if (firstError !== undefined) {
		throw firstError;
	}
}

/** status：只读概览。 */
async function cmdStatus(): Promise<number> {
	const pkgs = discoverPackages(ROOT);
	const pending = countPendingChangesets(ROOT);
	console.log(
		`[status] 可发布包 ${pkgs.length} 个；pending changeset ${pending.count} 个`,
	);
	for (const file of pending.files) {
		console.log(`  • ${file}`);
	}
	if (!(await probeRegistry())) {
		process.stderr.write(
			`[status] ⚠️ registry 不可达（${REGISTRY}），仅展示本地状态\n`,
		);
		return 0;
	}
	const published = await fetchAllPublished(pkgs);
	const plan = planPublish(pkgs, published);
	const downgraded = plan.toPublish.filter((pkg) =>
		isDowngrade(pkg.version, published.get(pkg.name) ?? new Set<string>()),
	);
	const toPublish = plan.toPublish.filter((pkg) => !downgraded.includes(pkg));
	const fresh = toPublish.filter(
		(pkg) => (published.get(pkg.name)?.size ?? 0) === 0,
	);
	if (downgraded.length > 0) {
		console.log(
			`[status] ⚠️ 本地版本低于 registry（${downgraded.length} 个，需排查）：`,
		);
		for (const pkg of downgraded) {
			console.log(`  ${pkg.name}@${pkg.version}`);
		}
	}
	if (toPublish.length > 0) {
		console.log(
			`[status] 待发布 ${toPublish.length} 个（其中首发 ${fresh.length} 个），发布序：`,
		);
		for (const pkg of topoSort(toPublish)) {
			console.log(
				`  ${pkg.name}@${pkg.version}${fresh.includes(pkg) ? "（首发）" : ""}`,
			);
		}
	} else {
		console.log("[status] 全部包已与 registry 同步");
	}
	console.log(`[status] 已同步 ${plan.skipped.length} 个`);
	return 0;
}

/** version 环的实际执行；bumpedDirs 供 pipeline 提交版本变化用。 */
async function runVersion(options: Options): Promise<{
	code: number;
	consumed: boolean;
	bumpedDirs: string[];
}> {
	const pending = countPendingChangesets(ROOT);
	if (pending.count === 0) {
		console.log("[version] 无 pending changeset，跳过");
		return { code: 0, consumed: false, bumpedDirs: [] };
	}
	if (options.dryRun) {
		console.log(
			`[version] [dry-run] 将执行 changeset version 消费 ${pending.count} 个条目，随后 bun install 刷新 lockfile`,
		);
		return { code: 0, consumed: false, bumpedDirs: [] };
	}
	const bin = join(ROOT, "node_modules", "@changesets", "cli", "bin.js");
	if (!existsSync(bin)) {
		process.stderr.write(
			"[version] ❌ 未找到 @changesets/cli（先 bun install）\n",
		);
		return { code: 1, consumed: false, bumpedDirs: [] };
	}
	const before = new Map(
		discoverPackages(ROOT).map((pkg) => [pkg.name, pkg.version]),
	);
	console.log(`[version] 📦 消费 ${pending.count} 个条目：changeset version`);
	let code = await run(process.execPath, [bin, "version"], ROOT);
	if (code !== 0) {
		console.log(`[version] ❌ changeset version 失败（退出码 ${code}）`);
		return { code, consumed: false, bumpedDirs: [] };
	}
	console.log("[version] 🔒 bun install 刷新 bun.lock（workspace 版本已变）");
	code = await run(process.execPath, ["install"], ROOT);
	if (code !== 0) {
		console.log(`[version] ❌ bun install 失败（退出码 ${code}）`);
		return { code, consumed: true, bumpedDirs: [] };
	}
	const after = discoverPackages(ROOT);
	const bumpedDirs: string[] = [];
	for (const pkg of after) {
		if (before.get(pkg.name) !== pkg.version) {
			bumpedDirs.push(relative(ROOT, pkg.dir));
		}
	}
	if (bumpedDirs.length === 0) {
		console.log("[version] ⚠️ 条目已消费但无版本变化（可能全部命中 ignore）");
	} else {
		console.log(`[version] ✅ ${bumpedDirs.length} 个包升版本：`);
		for (const pkg of after) {
			const old = before.get(pkg.name);
			if (old !== undefined && old !== pkg.version) {
				console.log(`  ${pkg.name}: ${old} → ${pkg.version}`);
			}
		}
	}
	return { code: 0, consumed: true, bumpedDirs };
}

/** 把版本相关变化提交（只 add 版本相关路径，绝不 git add -A——防 --allow-dirty 时卷入无关改动）。 */
async function commitVersionBumps(
	bumpedDirs: readonly string[],
): Promise<number> {
	const candidates = [".changeset", "bun.lock", "package.json"];
	for (const dir of bumpedDirs) {
		candidates.push(join(dir, "package.json"), join(dir, "CHANGELOG.md"));
	}
	const addPaths = candidates.filter((p) => existsSync(join(ROOT, p)));
	await run("git", ["add", ...addPaths], ROOT);
	const staged = (
		capture("git", ["diff", "--cached", "--name-only"], ROOT) ?? ""
	).trim();
	if (staged === "") {
		console.log("[pipeline] 版本相关文件无变化，跳过提交");
		return 0;
	}
	const code = await run(
		"git",
		["commit", "-m", "chore(release): 消费 changeset，升版本并更新 CHANGELOG"],
		ROOT,
	);
	if (code === 0) {
		console.log("[pipeline] ✅ 版本变化已提交");
	}
	return code;
}

/** webui 插件中需要 vite 构建前端 dist 的子集（files 含 dist 且有 client/；console 由宿主总装覆盖）。 */
function frontendTargets(pkgs: readonly PkgInfo[]): PkgInfo[] {
	const webuiRoot = join(ROOT, "plugins", "webui");
	return pkgs.filter(
		(pkg) =>
			pkg.dir.startsWith(webuiRoot) &&
			pkg.files.includes("dist") &&
			existsSync(join(pkg.dir, "client")) &&
			pkg.name !== "@koishi-ce/plugin-console",
	);
}

/** build 环：根 tsdown → 宿主控制台总装 → 各 webui 插件前端（并发池，失败即中断）。 */
async function runBuildSteps(options: Options): Promise<number> {
	if (options.dryRun) {
		const targets = frontendTargets(discoverPackages(ROOT));
		console.log(
			`[build] [dry-run] 将执行：根 tsdown → 宿主控制台总装 → ${targets.length} 个插件前端`,
		);
		for (const pkg of targets) {
			console.log(`  • ${pkg.name}`);
		}
		return 0;
	}
	console.log("[build] 🔨 根 tsdown：全部 node 侧包 → lib/");
	let code = await run(process.execPath, ["run", "build"], ROOT);
	if (code !== 0) {
		console.log(`[build] ❌ 根构建失败（退出码 ${code}）`);
		return code;
	}
	console.log("[build] 🔨 宿主控制台前端总装 → plugins/webui/console/dist");
	code = await run(
		process.execPath,
		["packages/web/client/src/bin.ts", "build"],
		ROOT,
	);
	if (code !== 0) {
		console.log(`[build] ❌ 宿主控制台总装失败（退出码 ${code}）`);
		return code;
	}
	const targets = frontendTargets(discoverPackages(ROOT));
	console.log(
		`[build] 🔨 ${targets.length} 个 webui 插件前端 dist（并发 ${BUILD_CONCURRENCY}）`,
	);
	const startedAt = Date.now();
	try {
		await runPool(targets, BUILD_CONCURRENCY, async (pkg) => {
			const pluginCode = await run(
				process.execPath,
				["packages/web/client/src/bin.ts", "build", pkg.dir],
				ROOT,
			);
			if (pluginCode !== 0) {
				throw new Error(`${pkg.name} 前端构建失败（退出码 ${pluginCode}）`);
			}
			console.log(`[build]   ✅ ${pkg.name}`);
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.log(`[build] ❌ ${message}，已中断`);
		return 1;
	}
	console.log(
		`[build] ✅ 构建完成（${((Date.now() - startedAt) / 1000).toFixed(1)}s）`,
	);
	return 0;
}

/** test 环：全量自有用例（与 AGENTS 门禁命令一致）。 */
async function runTestStep(): Promise<number> {
	console.log("[test] 🧪 bun test（packages + common + admin + commands）");
	return await run(
		process.execPath,
		[
			"test",
			"packages",
			"plugins/common",
			"plugins/webui/admin",
			"plugins/webui/commands",
		],
		ROOT,
	);
}

/** publish 环：registry 比对 → 所有权预检 → 拓扑序逐包发布。 */
async function runPublishSteps(options: Options): Promise<number> {
	const pkgs = discoverPackages(ROOT);
	if (!(await probeRegistry())) {
		process.stderr.write(
			`[publish] ❌ registry 不可达（${REGISTRY}），无法比对版本\n`,
		);
		return 1;
	}
	const published = await fetchAllPublished(pkgs);
	const plan = planPublish(pkgs, published);
	const downgraded = plan.toPublish.filter((pkg) =>
		isDowngrade(pkg.version, published.get(pkg.name) ?? new Set<string>()),
	);
	const toPublish = plan.toPublish.filter((pkg) => !downgraded.includes(pkg));
	for (const pkg of downgraded) {
		plan.skipped.push({
			pkg,
			reason: "本地版本低于 registry 已发布版本（源码落后，先同步源码）",
		});
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
		console.log(`[publish] 跳过 ${plan.skipped.length} 个：`);
		for (const { pkg, reason } of plan.skipped) {
			console.log(`  ⏭  ${pkg.name}@${pkg.version}（${reason}）`);
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
	const versions = new Map(pkgs.map((pkg) => [pkg.name, pkg.version]));
	for (const pkg of ordered) {
		const original = readFileSync(pkg.manifestPath, "utf8");
		const { text, changes } = rewriteWorkspaceProtocol(original, versions);
		if (changes.length > 0) {
			writeFileSync(pkg.manifestPath, text, "utf8");
			console.log(
				`[publish] ✍️  ${pkg.name}: workspace:* → ${changes.map((c) => `${c.dep}@${c.range}`).join(", ")}`,
			);
		}
		try {
			// stdin 直通终端：npm 的 OTP 浏览器认证要求 stdin/stdout 双 TTY，
			// 断开 stdin 会直接抛 EOTP（逐包弹浏览器逐包认证，属预期流程）
			const code = await runNpm(["publish", "--access", "public"], pkg.dir, {
				stdin: "inherit",
			});
			if (code !== 0) {
				console.log(
					`[publish] ❌ 发布失败 ${pkg.name}@${pkg.version}（退出码 ${code}），已中断`,
				);
				return code;
			}
			console.log(`[publish] ✅ 已发布 ${pkg.name}@${pkg.version}`);
		} finally {
			if (changes.length > 0) {
				writeFileSync(pkg.manifestPath, original, "utf8");
			}
		}
	}
	console.log("[publish] 全部完成");
	return 0;
}

/** pipeline：一条龙。每环失败即中断；全部环节重跑幂等。 */
async function cmdPipeline(options: Options): Promise<number> {
	console.log(
		`[pipeline] === 构建发布一条龙${options.dryRun ? "（dry-run）" : ""} ===`,
	);
	// preflight：分支 / 工作区洁净 / npm 登录
	const branch = capture(
		"git",
		["rev-parse", "--abbrev-ref", "HEAD"],
		ROOT,
	)?.trim();
	if (branch !== "main") {
		process.stderr.write(
			`[pipeline] ❌ 当前分支 ${branch ?? "未知"}，发布须在 main 上进行\n`,
		);
		return 1;
	}
	const dirty =
		(capture("git", ["status", "--porcelain"], ROOT) ?? "").trim() !== "";
	if (dirty && !options.allowDirty && !options.dryRun) {
		process.stderr.write(
			"[pipeline] ❌ 工作区有未提交改动；先提交，或用 --allow-dirty 跳过检查\n",
		);
		return 1;
	}
	if (dirty) {
		process.stderr.write(
			"[pipeline] ⚠️ 工作区有未提交改动（继续执行；版本提交只含版本相关文件）\n",
		);
	}
	if (!options.dryRun) {
		const whoami = npmWhoami(ROOT);
		if (whoami === null) {
			process.stderr.write("[pipeline] ❌ npm 未登录（先 npm login）\n");
			return 1;
		}
		console.log(`[pipeline] npm 身份：${whoami}`);
	}

	// version 环 + 版本提交
	const version = await runVersion(options);
	if (version.code !== 0) {
		return version.code;
	}
	if (!options.dryRun && version.consumed) {
		const commitCode = await commitVersionBumps(version.bumpedDirs);
		if (commitCode !== 0) {
			return commitCode;
		}
	}

	// build 环
	if (!options.skipBuild) {
		const buildCode = await runBuildSteps(options);
		if (buildCode !== 0) {
			return buildCode;
		}
	} else {
		console.log("[pipeline] ⏭ 跳过构建（--skip-build）");
	}

	// test 环
	if (!options.skipTest) {
		if (options.dryRun) {
			console.log("[pipeline] [dry-run] 将执行 bun test（全量自有用例）");
		} else {
			const testCode = await runTestStep();
			if (testCode !== 0) {
				console.log("[pipeline] ❌ 测试未通过，已中断");
				return testCode;
			}
		}
	} else {
		console.log("[pipeline] ⏭ 跳过测试（--skip-test）");
	}

	// publish 环
	const publishCode = await runPublishSteps(options);
	if (publishCode !== 0) {
		return publishCode;
	}

	if (options.dryRun) {
		console.log("[pipeline] [dry-run] 结束，未做任何变更");
		return 0;
	}

	// 推送
	if (options.push) {
		console.log("[pipeline] 📤 git push origin main");
		const code = await run("git", ["push", "origin", "main"], ROOT);
		if (code !== 0) {
			console.log("[pipeline] ❌ push main 失败");
			return code;
		}
	} else {
		console.log("[pipeline] 完成。尚未推送：git push origin main");
	}
	return 0;
}

/** CLI 入口：解析命令与旗标并分发。 */
async function main(): Promise<number> {
	const [command, ...rest] = process.argv.slice(2);
	if (command === undefined || command === "-h" || command === "--help") {
		console.log(HELP);
		return 0;
	}
	const options = parseOptions(rest);
	if (options === null) {
		process.stderr.write(
			"[release] ❌ 未知旗标（支持 --dry-run / --push / --allow-dirty / --skip-build / --skip-test）\n",
		);
		console.log(HELP);
		return 1;
	}
	switch (command) {
		case "status": {
			return await cmdStatus();
		}
		case "version": {
			return (await runVersion(options)).code;
		}
		case "build": {
			return await runBuildSteps(options);
		}
		case "publish": {
			return await runPublishSteps(options);
		}
		case "pipeline": {
			return await cmdPipeline(options);
		}
		default: {
			process.stderr.write(
				`[release] ❌ 未知命令 ${JSON.stringify(command)}\n`,
			);
			console.log(HELP);
			return 1;
		}
	}
}

try {
	process.exitCode = await main();
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`[release] ❌ ${message}\n`);
	process.exitCode = 1;
}
