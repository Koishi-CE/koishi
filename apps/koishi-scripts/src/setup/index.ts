// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * `koishi-scripts setup` 子命令：按统一范式初始化插件项目脚手架，产物落在
 * 宿主项目的 external/ 目录下（取代上游 yakumo 老模板——那套模板零 scripts、
 * 寄生宿主工具链，每生成一个项目都要手工改造）。生成的项目自带完整工具链：
 * TS7（@typescript/native）+ tsdown（CJS 产物，Node 宿主 loader require 与
 * Bun 宿主 require(esm) 两通用）+ biome + Changesets + AGENTS.md。
 *
 * 支持三种形态：
 * - 普通单包插件（默认）；
 * - monorepo 插件集合（--monorepo，仓库根级 changesets + koishi-plugin-* 的
 *   paths 映射 + packages/ 子包）；
 * - 带控制台前端扩展的插件（--console，追加 client/ 目录并补充
 *   @koishijs/client 与 @koishijs/plugin-console 依赖声明）。
 *
 * 模板的静态文本一律放在 src/template/ 下的真实文件里（shared/ 单包与
 * monorepo 共用、single/ 单包专属、monorepo/ 集合仓库根专属），写盘层只做
 * 定位、@@TOKEN@@ 占位替换与写盘；package.json 等强结构化清单在 manifests
 * 渲染。用法：
 *   koishi-scripts setup [name]                     # 交互式问询
 *   koishi-scripts setup --name=foo --desc=... --owner=Oppenheymu   # 非交互
 *
 * 问询项：① 包名（自动补 koishi-plugin- 前缀）② 描述 ③ GitHub 所有者
 * （默认值从兄弟项目的 repository 字段众数探测）。生成后 git init，
 * 不自动 commit、不自动 install——结束时打印后续步骤（包管理器一律 Bun）。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cwd, loadHostManifest } from "../index.ts";
import {
	gitConfig,
	parseFlags,
	resolveAnswers,
} from "./answers.ts";
import {
	FALLBACK_VERSIONS,
	type SetupOptions,
	type Versions,
} from "./manifests.ts";
import {
	writePackageFiles,
	writeRootFiles,
} from "./writer.ts";

/**
 * setup 主流程：问询 → 目录规划 → 写盘 → git init → 打印后续步骤。
 * 返回退出码（0 成功）。
 */
export default async function runSetup(
	args: readonly string[],
): Promise<number> {
	const flags = parseFlags(args);
	const options: SetupOptions = {
		monorepo:
			args.includes("--monorepo") || args.includes("-m"),
		console:
			args.includes("--console") || args.includes("-c"),
	};
	const answers = await resolveAnswers(flags);

	// monorepo：仓库根 external/<dirname>/，插件包在 packages/<dirname>/
	const rootDir = join(cwd, "external");
	const targetDir = options.monorepo
		? join(
				rootDir,
				answers.dirname,
				"packages",
				answers.dirname,
			)
		: join(rootDir, answers.dirname);
	const workspaceDir = options.monorepo
		? join(rootDir, answers.dirname)
		: targetDir;
	if (
		existsSync(workspaceDir) &&
		readdirSync(workspaceDir).length > 0
	) {
		throw new Error(
			`目标目录已存在且非空：external/${answers.dirname}`,
		);
	}

	// 作者（git 全局 user.name/email）与主分支（git init.defaultBranch，未配置则 main）
	const userName = gitConfig("user.name");
	const userEmail = gitConfig("user.email");
	const authorLine =
		userName !== ""
			? userEmail !== ""
				? `${userName} <${userEmail}>`
				: userName
			: "";
	const branch = gitConfig("init.defaultBranch") || "main";

	// koishi 生态版本号：宿主清单优先，兜底常量
	const host = await loadHostManifest();
	const versions: Versions = {
		koishi:
			host?.dependencies?.["koishi"] ??
			FALLBACK_VERSIONS.koishi,
		"@koishijs/client":
			host?.devDependencies?.["@koishijs/client"] ??
			FALLBACK_VERSIONS["@koishijs/client"],
		"@koishijs/plugin-console":
			host?.dependencies?.["@koishijs/plugin-console"] ??
			FALLBACK_VERSIONS["@koishijs/plugin-console"],
	};

	const projectDir = workspaceDir;
	console.log(
		`\n[setup] 目标目录：${projectDir.slice(cwd.length + 1) || projectDir}`,
	);
	console.log(
		`[setup] 包名：${answers.name}@0.1.0　主分支：${branch}　作者：${authorLine || "（未知）"}\n`,
	);

	if (options.monorepo) {
		writeRootFiles(
			projectDir,
			answers,
			authorLine,
			branch,
			"monorepo",
		);
		writePackageFiles(
			targetDir,
			answers,
			versions,
			authorLine,
			options,
			true,
		);
	} else {
		writePackageFiles(
			targetDir,
			answers,
			versions,
			authorLine,
			options,
			false,
		);
		writeRootFiles(
			targetDir,
			answers,
			authorLine,
			branch,
			"single",
		);
	}

	const gitInit = Bun.spawnSync({
		cmd: ["git", "init", "-b", branch],
		cwd: projectDir,
		stdout: "ignore",
		stderr: "ignore",
	});
	console.log(
		gitInit.success
			? `[setup] ✅ 已初始化 git 仓库（分支 ${branch}）`
			: "[setup] ⚠️ git init 失败（不影响脚手架文件）",
	);

	console.log(`
[setup] 🎉 完成！后续步骤：
  1. cd ${projectDir.slice(cwd.length + 1) || projectDir}
  2. 在宿主工作区根执行 bun install（注册 workspace 依赖到 lockfile）
  3. ${options.monorepo ? `bun run build && bun run --filter ${answers.name} check` : "bun run check && bun run build"} 验证门禁
  4. 没有 remote 时自行创建 GitHub 仓库并 git remote add origin …
  5. 开始写代码；用户可见改动随提交写 changeset（见 AGENTS.md）`);
	return 0;
}
