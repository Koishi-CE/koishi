/**
 * create-koishi-ce 脚手架入口（npm 包名 create-koishi-ce，目录名为
 * apps/koishi-create，二者不一致是历史遗留，以目录名为准）。
 *
 * 通过 `npx create-koishi-ce [name]` 交互式创建 Koishi 机器人应用项目：
 * 确定项目名 → 准备目标目录 → 从 npm registry 下载模板包（默认
 * @koishijs/boilerplate，刻意沿用上游官方模板以保持与上游插件生态一致）
 * 并解包 → 改写 package.json / .env → 按需初始化 git → 询问是否立即
 * 安装依赖并启动。由仓库根的 bin.js 经 require("./lib") 进入。
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { basename, join, relative } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import getRegistry from "get-registry";
import kleur from "kleur";
import prompts from "prompts";
import { extract } from "tar";
import { whichPMRuns } from "which-pm-runs";
import parse from "yargs-parser";

/** 项目目录名（rootDir 的最后一段，写入生成项目的 package.json 的 name） */
let project: string;
/** 目标目录的绝对路径（由用户输入的项目名拼接 cwd 得到） */
let rootDir: string;

/** fetch 请求非 2xx 时抛出的错误，携带 HTTP 状态码与状态文本 */
class HttpError extends Error {
	constructor(
		public status: number,
		public statusText: string,
	) {
		super(`HTTP ${status} ${statusText}`);
	}
}

// 自身版本号，取自 package.json（构建产物为 CJS，require 可用）
const { version } = require("../package.json");

// 执行脚手架时所在的工作目录，作为项目目录的基准
const cwd = process.cwd();

// 命令行参数（yargs-parser 解析），别名见 help 输出
const argv = parse(process.argv.slice(2), {
	alias: {
		ref: ["r"],
		forced: ["f"],
		git: ["g"],
		prod: ["p"],
		template: ["t"],
		yes: ["y"],
		help: ["h"],
	},
});

/** 静默执行命令探测其是否可用（如 `git --version`），失败即视为不可用 */
function supports(command: string) {
	try {
		execSync(command, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * 获取项目名：优先取第一个位置参数，否则交互式询问（默认 koishi-app）。
 */
async function getName() {
	if (argv._[0]) return `${argv._[0]}`;
	const { name } = await prompts({
		type: "text",
		name: "name",
		message: "Project name:",
		initial: "koishi-app",
	});
	return name.trim() as string;
}

/**
 * 递归清空目录内容（目录本身保留）。
 * 注意：基线运行环境是 Node 12，用不了 fs.rmSync，只能递归删除。
 */
function emptyDir(root: string) {
	for (const file of fs.readdirSync(root)) {
		const abs = join(root, file);
		if (fs.lstatSync(abs).isDirectory()) {
			emptyDir(abs);
			fs.rmdirSync(abs);
		} else {
			fs.unlinkSync(abs);
		}
	}
}

/** 交互式确认框：返回用户是否选择了「是」 */
async function confirm(message: string) {
	const { yes } = await prompts({
		type: "confirm",
		name: "yes",
		initial: "Y",
		message,
	});
	return yes as boolean;
}

/**
 * 准备目标目录：不存在则创建；已存在且非空时，未指定 --forced / --yes
 * 会先提示目录非空并询问是否清空后继续，用户拒绝则直接退出。
 */
async function prepare() {
	if (!fs.existsSync(rootDir)) {
		return fs.mkdirSync(rootDir, { recursive: true });
	}

	const files = fs.readdirSync(rootDir);
	if (!files.length) return;

	if (!argv.forced && !argv.yes) {
		console.log(kleur.yellow(`  Target directory "${project}" is not empty.`));
		const yes = await confirm("Remove existing files and continue?");
		if (!yes) process.exit(0);
	}

	emptyDir(rootDir);
}

/**
 * 模板下载与解包的主流程：
 * 1. 确定 npm registry（--registry 参数 > 本机 npm 配置 > 官方源）；
 * 2. 拉取模板包元数据，按 dist-tags 解析目标版本（--ref，默认 latest）；
 * 3. 流式下载 tarball 并解包到目标目录（strip: 1 去掉包根目录层级），
 *    网络错误统一以 HttpError 提示后退出；
 * 4. 最后改写 package.json 并刷新 .env。
 */
async function scaffold() {
	console.log(
		kleur.dim("  Scaffolding project in ") + project + kleur.dim(" ..."),
	);

	const registry = (
		argv.registry ||
		(await getRegistry()) ||
		"https://registry.npmjs.org"
	).replace(/\/$/, "");
	console.log(kleur.dim(`  Using registry: ${registry}\n`));
	const template = argv.template || "@koishijs/boilerplate";

	try {
		const metaRes = await fetch(`${registry}/${template}`);
		if (!metaRes.ok) throw new HttpError(metaRes.status, metaRes.statusText);
		const remote = await metaRes.json();
		const version = remote["dist-tags"][argv.ref || "latest"];
		const url = remote.versions[version].dist.tarball;
		const tarballRes = await fetch(url);
		const body = tarballRes.body;
		if (!tarballRes.ok || !body) {
			throw new HttpError(tarballRes.status, tarballRes.statusText);
		}

		await new Promise<void>((resolve, reject) => {
			Readable.fromWeb(body as unknown as NodeWebReadableStream)
				.pipe(extract({ cwd: rootDir, newer: true, strip: 1 }))
				.on("finish", resolve)
				.on("error", reject);
		});
	} catch (err) {
		if (!(err instanceof HttpError)) throw err;
		console.log(
			`${kleur.red("error")} request failed with status code ${err.status} ${err.statusText}`,
		);
		process.exit(1);
	}

	writePackageJson();
	writeEnvironment();

	console.log(kleur.green("  Done.\n"));
}

/**
 * 改写模板的 package.json：替换项目名、标记 private、版本归零。
 */
function writePackageJson() {
	const filename = join(rootDir, "package.json");
	const meta = require(filename);
	meta.name = project;
	meta.private = true;
	meta.version = "0.0.0";
	if (argv.prod) {
		// https://github.com/koishijs/koishi/issues/994
		// 生产模式不借助 NODE_ENV 或 --production 标志，
		// 而是直接删掉 devDependencies 与 workspaces 字段。
		delete meta.workspaces;
		delete meta.devDependencies;
	}
	fs.writeFileSync(filename, `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * 模板自带 .env 时原样读入并写回一次（无 .env 则跳过）。
 */
function writeEnvironment() {
	const filename = join(rootDir, ".env");
	if (!fs.existsSync(filename)) return;
	const content = fs.readFileSync(filename, "utf8");
	fs.writeFileSync(filename, content);
}

/**
 * 初始化 git 仓库：仅在显式传入 --git 且本机装有 git 时执行。
 */
async function initGit() {
	if (!argv.git || !supports("git --version")) return;
	execSync("git init", { stdio: "ignore", cwd: rootDir });
	console.log(kleur.green("  Done.\n"));
}

/**
 * 收尾交互：询问是否立即安装依赖并启动。包管理器通过 whichPMRuns()
 * 探测当前进程的宿主 agent（npm / yarn / pnpm …），探测不到则退回 npm；
 * 用户拒绝时打印后续手动安装与启动的命令。
 */
async function install() {
	// 指定 -y 时跳过依赖安装（供 CI 等需要静默生成的场景）
	if (argv.yes) return;

	const agent = whichPMRuns()?.name || "npm";
	const yes = await confirm("Install and start it now?");
	if (yes) {
		execSync([agent, "install"].join(" "), { stdio: "inherit", cwd: rootDir });
		execSync([agent, "run", "start"].join(" "), {
			stdio: "inherit",
			cwd: rootDir,
		});
	} else {
		console.log(kleur.dim("  You can start it later by:\n"));
		if (rootDir !== cwd) {
			const related = relative(cwd, rootDir);
			console.log(kleur.blue(`  cd ${kleur.bold(related)}`));
		}
		console.log(
			kleur.blue(`  ${agent === "yarn" ? "yarn" : `${agent} install`}`),
		);
		console.log(
			kleur.blue(`  ${agent === "yarn" ? "yarn start" : `${agent} run start`}`),
		);
		console.log();
	}
}

/**
 * CLI 主流程：--help 打印用法后即返回；否则依次执行
 * 项目名询问 → prepare（目录准备）→ scaffold（模板解包）→ initGit → install。
 */
async function start() {
	if (argv.help) {
		console.log(`
  Usage: create-koishi [name] [options]

  Options:
    -t, --template <name>  Template to use (default: @koishijs/boilerplate)
    -r, --ref <ref>        Reference to use (default: latest)
    -f, --forced           Force overwrite target directory
    -g, --git              Initialize git repository
        --registry <url>   Use specific registry (e.g., https://registry.npmmirror.com)
    -p, --prod             Production mode
    -y, --yes              Skip prompts
    -h, --help             Show this help message
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

// 入口：直接执行顶层流程，异常统一打到 stderr
start().catch((e) => {
	console.error(e);
});
