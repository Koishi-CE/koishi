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
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgv } from "./args.ts";
import {
	DEFAULT_TARGET,
	dim,
	green,
	ROOT,
	red,
	SCOPE,
	yellow,
} from "./config.ts";
import { applyLinks, planLinks } from "./links.ts";
import type { PackEntry } from "./manifest.ts";
import { buildSandboxPackageJson } from "./manifest.ts";
import {
	claimTarget,
	copyTemplateBaselines,
	writeMarker,
} from "./target.ts";
import {
	checkBuildArtifacts,
	resolveWorkspacePackages,
} from "./workspace.ts";

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
		`  链接包：${plan.length} 个（新建 ${counts["create"]} / 重建 ${counts["rebuild"]} / 复用 ${counts["keep"]}）`,
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
