// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * create-koishi-ce 脚手架（npm 包名 create-koishi-ce，目录名为
 * apps/koishi-create，二者不一致是历史遗留，以目录名为准）。
 *
 * 通过 `bunx create-koishi-ce [name]`（npx 亦可）交互式创建 Koishi 机器人
 * 应用项目：确定项目名 → 准备目标目录 → 写入内置 @koishi-ce 模板（默认，
 * 见 src/template.ts；--template <包名> 可改用 npm registry 远程模板，如
 * 上游官方 @koishijs/boilerplate）→ 按需初始化 git → 询问是否立即安装
 * 依赖并启动。CLI 可执行入口在 src/bin.ts（构建产物 lib/bin.mjs，bin 字段
 * 指向它）。
 *
 * 本文件是 CLI 的编排层：承载参数解析与运行期状态（argv / cwd /
 * project / rootDir —— 它们被 e2e 测试以模块 query 隔离实例，必须留在
 * 顶层模块内）与交互主流程。纯函数与单一职责的子流程按域拆到同目录
 * 子模块，公共导出面在文件尾原样 re-export（bin 与测试的导入路径不变）：
 * - manifest.ts   package.json 改写（Manifest / renderManifest）
 * - registry.ts   本机 npm registry 配置探测
 * - utils.ts      平台小工具（包管理器 / git 探测、清空目录）
 * - remote.ts     --template 远程模板的下载-解包-改写全流程
 * - template.ts   内置 @koishi-ce 模板（静态文件与 baseManifest）
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import kleur from "kleur";
import pkg from "../package.json" with { type: "json" };
import { type Manifest, renderManifest } from "./manifest.ts";
import { getLocalRegistry, readNpmrcRegistry } from "./registry.ts";
import { scaffoldRemote } from "./remote.ts";
import { baseManifest, templateFiles } from "./template.ts";
import { detectAgent, emptyDir, gitConfig, supports } from "./utils.ts";

const { version } = pkg;

export type { Manifest };
// 公共导出面：与拆分前保持一致（bin.ts 与测试文件按 ../index.ts 的既有
// 导入路径原样可用）；子模块的其余导出属于包内部实现，不在此暴露。
export { detectAgent, getLocalRegistry, readNpmrcRegistry, renderManifest };

/** CLI 参数（node:util parseArgs 解析，别名映射见 bin 帮助文本） */
interface Args {
	_: string[];
	registry?: string;
	ref?: string;
	forced?: boolean;
	git?: boolean;
	prod?: boolean;
	template?: string;
	yes?: boolean;
	help?: boolean;
}

// 命令行参数（顶层解析；无副作用，单测导入本文件不会触发主流程）。
// 用 node:util 的 parseArgs（Bun 内置同一 API）替代 yargs-parser：结果按
// values / positionals 分离，此处合并回旧的 argv 形态，其余引用点不变。
// 未知选项在 strict 模式下直接抛错（yargs-parser 会静默忽略，此处更严格）。
const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		registry: { type: "string" },
		ref: { type: "string", short: "r" },
		forced: { type: "boolean", short: "f" },
		git: { type: "boolean", short: "g" },
		prod: { type: "boolean", short: "p" },
		template: { type: "string", short: "t" },
		yes: { type: "boolean", short: "y" },
		help: { type: "boolean", short: "h" },
	},
	allowPositionals: true,
});
const argv = { ...values, _: positionals } as Args;

/** 项目目录名（rootDir 的最后一段，写入生成项目的 package.json 的 name） */
let project: string;
/** 目标目录的绝对路径（由用户输入的项目名拼接 cwd 得到） */
let rootDir: string;

// 执行脚手架时所在的工作目录，作为项目目录的基准
const cwd = process.cwd();

/**
 * 获取项目名：优先取第一个位置参数，否则交互式询问（默认 koishi-app）。
 * 用户取消（Ctrl+C）或输入为空时直接退出（不强行兜底默认值）。
 */
async function getName(): Promise<string> {
	if (argv._[0]) return `${argv._[0]}`;
	const answer = await p.text({
		message: "项目名：",
		initialValue: "koishi-app",
		validate: (value) => (value?.trim() ? undefined : "项目名不能为空"),
	});
	if (p.isCancel(answer)) process.exit(0);
	const trimmed = answer.trim();
	if (!trimmed) process.exit(0);
	return trimmed;
}

/** 交互式确认框：返回用户是否选择了「是」（Ctrl+C 取消直接退出） */
async function confirm(message: string) {
	const answer = await p.confirm({ message, initialValue: true });
	if (p.isCancel(answer)) process.exit(0);
	return answer === true;
}

/**
 * 准备目标目录：不存在则创建；已存在且非空时，未指定 --forced / --yes
 * 会先提示目录非空并询问是否清空后继续，用户拒绝则直接退出。
 */
async function prepare() {
	if (!existsSync(rootDir)) {
		mkdirSync(rootDir, { recursive: true });
		return;
	}

	const files = readdirSync(rootDir);
	if (!files.length) return;

	if (!argv.forced && !argv.yes) {
		console.log(kleur.yellow(`  目标目录 "${project}" 非空。`));
		const yes = await confirm("清空现有文件并继续？");
		if (!yes) process.exit(0);
	}

	emptyDir(rootDir);
}

/**
 * 写入内置模板（默认路径）：静态文件（src/template.ts 的 templateFiles）
 * 加上由 baseManifest() 渲染出的 package.json。纯本地写入，无网络请求。
 */
function scaffoldBuiltin() {
	for (const [file, content] of Object.entries(templateFiles)) {
		writeFileSync(join(rootDir, file), content);
	}
	writeFileSync(
		join(rootDir, "package.json"),
		renderManifest(baseManifest(), project, argv.prod === true),
	);
}

/**
 * 生成项目的主入口：默认写内置 @koishi-ce 模板（scaffoldBuiltin）；
 * --template <包名> 时改为从 npm registry 下载远程模板（remote.ts 的
 * scaffoldRemote），registry 取值 --registry 参数 > 本机 npm 配置 > 官方源。
 */
async function scaffold() {
	console.log(kleur.dim("  正在 ") + project + kleur.dim(" 中生成项目 ..."));

	if (argv.template) {
		const registry = (
			argv.registry ||
			getLocalRegistry() ||
			"https://registry.npmjs.org"
		).replace(/\/$/, "");
		console.log(kleur.dim(`  使用 registry：${registry}\n`));
		// 运行期状态不跨模块共享：远程分支所需字段在此显式组装后传入
		await scaffoldRemote({
			registry,
			template: argv.template,
			ref: argv.ref || "latest",
			prod: argv.prod === true,
			project,
			rootDir,
		});
	} else {
		scaffoldBuiltin();
	}

	console.log(kleur.green("  完成。\n"));
}

/**
 * 初始化 git 仓库：仅在显式传入 --git 且本机装有 git 时执行，分支名取
 * git 的 init.defaultBranch（未配置则 main）。
 */
async function initGit() {
	if (!argv.git || !supports(["git", "--version"])) return;
	const branch = gitConfig("init.defaultBranch") || "main";
	spawnSync("git", ["init", "-b", branch], { stdio: "ignore", cwd: rootDir });
	console.log(kleur.green(`  已初始化 git 仓库（分支 ${branch}）。\n`));
}

/**
 * 收尾交互：询问是否立即安装依赖并启动，包管理器由 detectAgent()
 * Bun-first 探测；用户拒绝时打印后续手动安装与启动的命令。
 */
async function install() {
	// 指定 -y 时跳过依赖安装（供 CI 等需要静默生成的场景）
	if (argv.yes) return;

	const agent = detectAgent();
	const startArgs = agent === "yarn" ? ["start"] : ["run", "start"];
	const yes = await confirm("现在安装依赖并启动吗？");
	if (yes) {
		const installed = spawnSync(agent, ["install"], {
			stdio: "inherit",
			cwd: rootDir,
		});
		if (installed.status !== 0) {
			console.log(kleur.red("  依赖安装失败，请检查上方日志。"));
			return;
		}
		spawnSync(agent, startArgs, { stdio: "inherit", cwd: rootDir });
	} else {
		console.log(kleur.dim("  稍后可以这样启动：\n"));
		if (rootDir !== cwd) {
			const related = relative(cwd, rootDir);
			console.log(kleur.blue(`  cd ${kleur.bold(related)}`));
		}
		console.log(
			kleur.blue(`  ${agent === "yarn" ? "yarn" : `${agent} install`}`),
		);
		console.log(
			kleur.blue(`  ${agent === "yarn" ? "yarn" : `${agent} run`} start`),
		);
		console.log();
	}
}

/**
 * CLI 主流程：--help 打印用法后即返回；否则依次执行
 * 项目名询问 → prepare（目录准备）→ scaffold（模板解包）→ initGit → install。
 */
export async function start() {
	if (argv.help) {
		console.log(`
  用法：create-koishi-ce [名称] [选项]

  选项：
    -t, --template <名称>   从 npm registry 下载指定模板包（默认使用内置 @koishi-ce 模板）
    -r, --ref <引用>        远程模板版本引用（默认 latest）
    -f, --forced            强制清空目标目录
    -g, --git               初始化 git 仓库
        --registry <地址>   指定 npm registry（如 https://registry.npmmirror.com）
    -p, --prod              生产模式（移除 devDependencies 与 workspaces）
    -y, --yes               跳过全部询问
    -h, --help              显示本帮助
`);
		return;
	}

	console.log();
	console.log(`  ${kleur.bold("Create Koishi")}  ${kleur.blue(`v${version}`)}`);
	console.log();

	const name = await getName();
	rootDir = join(cwd, name);
	project = basename(rootDir);

	await prepare();
	await scaffold();
	await initGit();
	await install();
}
