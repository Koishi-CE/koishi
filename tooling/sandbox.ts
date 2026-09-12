// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 外部沙盒实例生成器（零依赖，bun 直跑）。
 *
 * 在工作区之外生成一个由本仓 workspace 包组成的 koishi-ce 运行实例，用于
 * 「先测试再发包」的开发与验收：数据写回、市场装插件等运行时副作用全部落
 * 在沙盒目录（loader 的 baseDir 取自进程 cwd 与配置文件位置），工作区零污染。
 *
 * 用法：
 *   bun run sandbox [目录]           链接模式（默认）：沙盒 node_modules 里为
 *                                    全部 CE 作用域 workspace 包建 junction；
 *                                    改 src → bun run build 后实例即刻生效。
 *   bun run sandbox [目录] --pack    打包模式：逐包 bun pm pack 出 tgz（与
 *                                    npm 发布物同构，workspace:* 自动重写为
 *                                    版本号），走真实 bun install，供发版前
 *                                    预演发布面（files 白名单 / exports 映射）。
 *   旗标 --force：清空重建已存在的沙盒（仅限本工具生成的目录）。
 *
 * 依赖解析机理（链接模式）：沙盒 node_modules 只含手工 junction，外部 npm
 * 依赖不安装——Bun 按包真实路径向上爬链，落到工作区根 node_modules。因此
 * 沙盒内不要跑 bun install（会清理手工 junction）；在沙盒里经市场装过插件
 * 后重跑 bun run sandbox 即可秒级补链。
 *
 * 与本仓 plugins/webui/sandbox 插件（控制台内嵌调试沙盒）无任何关系。
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/** 仓库根目录（本脚本位于 tooling/ 下）。 */
const ROOT = resolve(import.meta.dirname, "..");

/** 脚手架内置模板目录（沙盒的 koishi.yml 等基线从这里复用）。 */
const TEMPLATE_DIR = join(
	ROOT,
	"apps/koishi-create/src/template",
);

/** 沙盒目录的身份标记文件：无此文件的目录一律拒绝处理。 */
const MARKER = ".koishi-ce-sandbox.json";

/** 默认落点：工作区同级目录（不在仓库内部，天然隔离）。 */
const DEFAULT_TARGET = resolve(
	ROOT,
	"..",
	"koishi-ce-sandbox",
);

/** 参与 junction 链接的包作用域（create-koishi-ce 等非 CE 作用域工具跳过）。 */
const SCOPE = "@koishi-ce/";

/** 极简 ANSI 着色（保持零依赖，不引 picocolors）。 */
const red = (text: string) => `\x1b[31m${text}\x1b[39m`;
const green = (text: string) => `\x1b[32m${text}\x1b[39m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[39m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[39m`;

/** 命令行参数的解析结果。 */
export interface SandboxOptions {
	/** 沙盒落点（缺省用工作区同级 koishi-ce-sandbox）。 */
	target?: string;
	/** 打包模式（bun pm pack + 真实 install）。 */
	pack: boolean;
	/** 清空重建已存在的沙盒。 */
	force: boolean;
}

/**
 * 解析命令行参数：首个非旗标位置参数为落点目录；`--`（bun run 透传分隔符）
 * 忽略；`--pack` / `--force` 为旗标。其余旗标不识别，报错退出。
 */
export function parseArgv(argv: string[]): SandboxOptions {
	const options: SandboxOptions = {
		pack: false,
		force: false,
	};
	for (const arg of argv) {
		if (arg === "--") continue;
		if (arg === "--pack") {
			options.pack = true;
		} else if (arg === "--force") {
			options.force = true;
		} else if (arg.startsWith("--")) {
			throw new Error(
				`未知旗标：${arg}（仅支持 --pack / --force）`,
			);
		} else if (options.target === undefined) {
			options.target = arg;
		} else {
			throw new Error(`多余的落点参数：${arg}`);
		}
	}
	return options;
}

/** 枚举出的一个 workspace 包（目录 + 包名）。 */
export interface WorkspacePackage {
	/** 包名（如 @koishi-ce/core）。 */
	name: string;
	/** 包目录绝对路径。 */
	dir: string;
}

/**
 * 按根 package.json 的 workspaces 声明枚举全部包：glob 扫出目录，取其中
 * 含 package.json 且带 name 的子目录。不检查作用域（由调用方按需过滤）。
 */
export function resolveWorkspacePackages(
	root: string,
): WorkspacePackage[] {
	const manifest = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	) as { workspaces?: string[] };
	const workspaces = manifest.workspaces ?? [];
	const packages: WorkspacePackage[] = [];
	const seen = new Set<string>();
	for (const pattern of workspaces) {
		// Bun 1.4.2 win32 下 scanSync 的位置参数形态恒返回空，须用对象形态传 cwd
		for (const entry of new Bun.Glob(pattern).scanSync({
			cwd: root,
			onlyFiles: false,
		})) {
			const dir = resolve(root, entry);
			if (seen.has(dir)) continue;
			seen.add(dir);
			const file = join(dir, "package.json");
			if (!existsSync(file)) continue;
			const name = (
				JSON.parse(readFileSync(file, "utf8")) as {
					name?: string;
				}
			).name;
			if (!name) continue;
			packages.push({ name, dir });
		}
	}
	return packages;
}

/** 单条链接的动作判定（planLinks 产出）。 */
export interface LinkPlanEntry {
	name: string;
	/** 链接落点（沙盒 node_modules 内）。 */
	link: string;
	/** 链接目标（工作区包目录绝对路径）。 */
	target: string;
	/** create 新建 / keep 已一致 / rebuild 指向错误须重建 / skip-entity 实体目录让位。 */
	action: "create" | "keep" | "rebuild" | "skip-entity";
}

/**
 * 为全部 CE 作用域包生成链接计划：链接名取去作用域后的短名
 * （@koishi-ce/core → node_modules/@koishi-ce/core）。
 *
 * 判定规则：
 * - 不存在 → create；
 * - junction/symlink 且真实路径与目标一致 → keep；
 * - junction/symlink 但指向不同 → rebuild；
 * - 实体目录/文件（如市场装出的 npm 包）→ skip-entity，绝不覆盖用户主动安装。
 */
export function planLinks(
	packages: WorkspacePackage[],
	nodeModulesDir: string,
): LinkPlanEntry[] {
	const scopedRoot = join(nodeModulesDir, SCOPE);
	const plan: LinkPlanEntry[] = [];
	for (const pkg of packages) {
		if (!pkg.name.startsWith(SCOPE)) continue;
		const short = pkg.name.slice(SCOPE.length);
		const link = join(scopedRoot, short);
		const target = pkg.dir;
		let action: LinkPlanEntry["action"] = "create";
		// 用 lstat 判存在而非 existsSync：后者对悬空 junction（目标已删）返回
		// false，会误判为 create 并在 symlinkSync 时抛 EEXIST
		let stats: ReturnType<typeof lstatSync>;
		try {
			stats = lstatSync(link);
		} catch {
			stats = undefined;
		}
		if (stats?.isSymbolicLink()) {
			try {
				// 两侧统一小写比较（win32 盘符与路径大小写形态可能不一致）
				const current = realpathSync(link).toLowerCase();
				action =
					current === target.toLowerCase()
						? "keep"
						: "rebuild";
			} catch {
				// 悬空 junction：目标不存在，直接重建
				action = "rebuild";
			}
		} else if (stats) {
			action = "skip-entity";
		}
		plan.push({ name: pkg.name, link, target, action });
	}
	return plan;
}

/** 执行链接计划，返回各动作的计数（用于摘要输出）。 */
export function applyLinks(
	plan: LinkPlanEntry[],
): Record<string, number> {
	const counts = {
		create: 0,
		keep: 0,
		rebuild: 0,
		"skip-entity": 0,
	};
	for (const entry of plan) {
		if (entry.action === "rebuild") {
			rmSync(entry.link, { recursive: true, force: true });
		}
		if (
			entry.action === "create" ||
			entry.action === "rebuild"
		) {
			mkdirSync(dirname(entry.link), { recursive: true });
			symlinkSync(entry.target, entry.link, "junction");
		}
		counts[entry.action]++;
	}
	return counts;
}

/** 打包模式的 tgz 落盘记录（生成 package.json dependencies 用）。 */
export interface PackEntry {
	name: string;
	/** tgz 文件名（如 koishi-ce-core-1.0.0.tgz）。 */
	file: string;
}

/**
 * 生成沙盒 package.json。scripts.start 直指 cli 入口文件而非 .bin：链接模式
 * 的 .bin 非 bun install 产物（win32 需 .exe stub，手工伪造不可靠），两模式
 * 统一直指文件路径，用户侧入口均为 `bun start`。
 *
 * 链接模式同样声明默认插件依赖（与脚手架模板一致）：loader 启动时会做
 * manifest 迁移（migrateManifest 按进程 cwd 读 package.json），发现宿主未
 * 声明这些插件就会自动补挂插件键并改写 koishi.yml，与模板 yml 里已有的
 * 同名键撞出 duplicate plugin 警告。打包模式的 dependencies 即全部 tgz，
 * 天然包含这三个键。
 */
export function buildSandboxPackageJson(
	mode: "link" | "pack",
	packed?: PackEntry[],
): Record<string, unknown> {
	const manifest: Record<string, unknown> = {
		name: "koishi-ce-sandbox",
		version: "0.0.0",
		private: true,
		type: "module",
		scripts: {
			start:
				"bun node_modules/@koishi-ce/koishi/lib/cli/index.mjs start",
		},
		dependencies: {
			"@koishi-ce/plugin-http": "^1.0.0",
			"@koishi-ce/plugin-proxy-agent": "^1.0.0",
			"@koishi-ce/plugin-server": "^1.0.0",
		},
	};
	if (mode === "pack") {
		const dependencies: Record<string, string> = {};
		for (const entry of packed ?? []) {
			dependencies[entry.name] =
				`file:./vendor/${entry.file}`;
		}
		manifest.dependencies = dependencies;
	}
	return manifest;
}

/** 链接模式的运行前提抽查：宿主入口与前端宿主产物缺失时给出明确指引。 */
function checkBuildArtifacts(
	packages: WorkspacePackage[],
): string[] {
	const missing: string[] = [];
	const byName = new Map(
		packages.map((pkg) => [pkg.name, pkg.dir]),
	);
	const cli = byName.get("@koishi-ce/koishi");
	if (!cli || !existsSync(join(cli, "lib/cli/index.mjs"))) {
		missing.push("packages/node/cli/lib/cli/index.mjs");
	}
	const core = byName.get("@koishi-ce/core");
	if (!core || !existsSync(join(core, "lib/index.mjs"))) {
		missing.push("packages/node/core/lib/index.mjs");
	}
	if (
		!existsSync(
			join(ROOT, "plugins/webui/console/dist/index.html"),
		)
	) {
		missing.push("plugins/webui/console/dist/index.html");
	}
	return missing;
}

/** 沙盒身份标记的读取（不存在或损坏一律视为非本工具目录）。 */
function readMarker(
	target: string,
): { mode: string } | undefined {
	try {
		const data = JSON.parse(
			readFileSync(join(target, MARKER), "utf8"),
		) as { generator?: string; mode?: string };
		if (data.generator !== "tooling/sandbox.ts")
			return undefined;
		return { mode: data.mode ?? "link" };
	} catch {
		return undefined;
	}
}

/** 写身份标记（每次运行刷新，记录模式与时间）。 */
function writeMarker(
	target: string,
	mode: "link" | "pack",
) {
	writeFileSync(
		join(target, MARKER),
		`${JSON.stringify(
			{
				generator: "tooling/sandbox.ts",
				mode,
				createdAt: new Date().toISOString(),
			},
			null,
			"\t",
		)}\n`,
	);
}

/** 目标目录的准入检查：不存在直接放行；存在则须为本工具目录（--force 重建）。 */
function claimTarget(
	target: string,
	force: boolean,
): { fresh: boolean; marker?: { mode: string } } {
	if (!existsSync(target)) return { fresh: true };
	const marker = readMarker(target);
	if (!marker) {
		console.error(
			red(
				`拒绝处理：${target} 已存在且非本工具生成的沙盒（无 ${MARKER}）。`,
			),
		);
		console.error("请更换目录，或手动清理该目录后重试。");
		process.exit(1);
	}
	if (!force) return { fresh: false, marker };
	rmSync(target, { recursive: true, force: true });
	console.log(yellow(`已按 --force 清空重建：${target}`));
	return { fresh: true };
}

/** 复用脚手架内置模板生成基线文件：仅首次生成时落盘，不覆盖用户改动。 */
function copyTemplateBaselines(target: string) {
	const copies: Array<[string, string]> = [
		["koishi.yml", "koishi.yml"],
		["env", ".env"],
		["gitignore", ".gitignore"],
	];
	for (const [from, to] of copies) {
		const dest = join(target, to);
		const src = join(TEMPLATE_DIR, from);
		if (!existsSync(src) || existsSync(dest)) continue;
		cpSync(src, dest);
	}
}

/** 链接模式主流程。 */
function cmdLink(target: string, force: boolean) {
	const packages = resolveWorkspacePackages(ROOT);
	if (packages.length === 0) {
		console.error(
			red(
				"未枚举到任何 workspace 包，检查根 package.json。",
			),
		);
		process.exit(1);
	}
	const missing = checkBuildArtifacts(packages);
	if (missing.length > 0) {
		console.error(
			red("构建产物缺失，请先在仓库根执行 bun run build："),
		);
		for (const file of missing)
			console.error(`  - ${file}`);
		process.exit(1);
	}

	const claim = claimTarget(target, force);
	mkdirSync(target, { recursive: true });
	if (claim.fresh) {
		writeFileSync(
			join(target, "package.json"),
			`${JSON.stringify(
				buildSandboxPackageJson("link"),
				null,
				"\t",
			)}\n`,
		);
		copyTemplateBaselines(target);
	}
	writeMarker(target, "link");

	const plan = planLinks(
		packages,
		join(target, "node_modules"),
	);
	const counts = applyLinks(plan);
	const skipped = plan
		.filter((entry) => entry.action === "skip-entity")
		.map((entry) => entry.name);

	console.log(green(`沙盒实例已就绪：${target}`));
	console.log(
		`  链接包：${plan.length} 个（新建 ${counts.create} / 重建 ${counts.rebuild} / 复用 ${counts.keep}）`,
	);
	if (skipped.length > 0) {
		console.log(
			yellow(
				`  实体包让位（保留沙盒内已安装的 npm 版本）：${skipped.join("、")}`,
			),
		);
	}
	console.log(
		dim(
			"  外部依赖：复用工作区根 node_modules（真实路径向上爬链解析）",
		),
	);
	console.log(`启动：cd ${target} && bun start`);
}

/** 打包模式主流程：逐包 bun pm pack → vendor/ → 真实 bun install。 */
function cmdPack(target: string, force: boolean) {
	const packages = resolveWorkspacePackages(ROOT).filter(
		(pkg) => pkg.name.startsWith(SCOPE),
	);
	if (packages.length === 0) {
		console.error(
			red(
				"未枚举到任何 workspace 包，检查根 package.json。",
			),
		);
		process.exit(1);
	}
	const missing = checkBuildArtifacts(packages);
	if (missing.length > 0) {
		console.error(
			red("构建产物缺失，请先在仓库根执行 bun run build："),
		);
		for (const file of missing)
			console.error(`  - ${file}`);
		process.exit(1);
	}

	// 准入检查（含 --force 清空重建）；pack 模式直接在既有目录上增量重建
	claimTarget(target, force);
	mkdirSync(target, { recursive: true });
	copyTemplateBaselines(target);

	const vendor = join(target, "vendor");
	rmSync(vendor, { recursive: true, force: true });
	mkdirSync(vendor, { recursive: true });

	const packed: PackEntry[] = [];
	const failed: Array<{ name: string; reason: string }> =
		[];
	for (const pkg of packages) {
		const result = spawnSync("bun", ["pm", "pack"], {
			cwd: pkg.dir,
			encoding: "utf8",
		});
		if (result.status !== 0) {
			const reason =
				(result.stderr ?? "").trim().split("\n").pop() ??
				"";
			failed.push({ name: pkg.name, reason });
			continue;
		}
		const line = (result.stdout ?? "")
			.split("\n")
			.map((row) => row.trim())
			.find((row) => row.endsWith(".tgz"));
		if (!line) {
			failed.push({
				name: pkg.name,
				reason: "未解析到 tgz 文件名",
			});
			continue;
		}
		// tgz 产生在包目录内，立即搬走，保证工作区不留任何残留
		renameSync(join(pkg.dir, line), join(vendor, line));
		packed.push({ name: pkg.name, file: line });
	}

	writeFileSync(
		join(target, "package.json"),
		`${JSON.stringify(
			buildSandboxPackageJson("pack", packed),
			null,
			"\t",
		)}\n`,
	);
	writeMarker(target, "pack");

	console.log(
		`打包 ${packed.length} 个包 → vendor/（${failed.length} 个失败）`,
	);
	for (const item of failed) {
		console.error(red(`  - ${item.name}：${item.reason}`));
	}
	if (failed.length > 0 && packed.length === 0) {
		process.exit(1);
	}

	console.log("安装依赖（外部依赖从 npm 拉取）...");
	const install = spawnSync("bun", ["install"], {
		cwd: target,
		stdio: ["ignore", "inherit", "inherit"],
	});
	if (install.status !== 0) {
		console.error(
			red("bun install 失败，请检查上方输出。"),
		);
		process.exit(1);
	}
	console.log(green(`沙盒实例已就绪：${target}`));
	console.log(`启动：cd ${target} && bun start`);
}

/** 入口：import.meta.main 守卫使本模块可被测试安全导入。 */
if (import.meta.main) {
	const options = parseArgv(process.argv.slice(2));
	const target = resolve(options.target ?? DEFAULT_TARGET);
	console.log(
		dim(
			`沙盒落点：${target}（${options.pack ? "打包模式" : "链接模式"}）`,
		),
	);
	if (options.pack) {
		cmdPack(target, options.force);
	} else {
		cmdLink(target, options.force);
	}
}
