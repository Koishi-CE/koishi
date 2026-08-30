/**
 * create-koishi-ce 脚手架（npm 包名 create-koishi-ce，目录名为
 * apps/koishi-create，二者不一致是历史遗留，以目录名为准）。
 *
 * 通过 `bunx create-koishi-ce [name]`（npx 亦可）交互式创建 Koishi 机器人
 * 应用项目：确定项目名 → 准备目标目录 → 写入内置 @koishi-ce 模板（默认，
 * 见 src/template.ts；--template <包名> 可改用 npm registry 远程模板，如
 * 上游官方 @koishijs/boilerplate）→ 按需初始化 git → 询问是否立即安装
 * 依赖并启动。CLI 可执行入口在 src/bin.ts（构建产物 lib/bin.mjs，bin 字段
 * 指向它）；本文件只承载主流程与可单测的纯函数（范式对齐
 * @koishi-ce/scripts）。
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import kleur from "kleur";
import prompts from "prompts";
import { extract } from "tar";
import parse from "yargs-parser";
import pkg from "../package.json" with { type: "json" };
import { baseManifest, templateFiles } from "./template.ts";

const { version } = pkg;

/** CLI 参数（yargs-parser 解析，别名映射见 bin 帮助文本） */
interface Args {
	_: Array<string | number>;
	registry?: string;
	ref?: string;
	forced?: boolean;
	git?: boolean;
	prod?: boolean;
	template?: string;
	yes?: boolean;
	help?: boolean;
}

/**
 * 模板项目的 package.json（改写目标）：只需要类型化本流程触碰的字段，
 * 其余字段经 index signature 原样保留。
 */
export interface Manifest {
	name?: string;
	private?: boolean;
	version?: string;
	workspaces?: unknown;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	[key: string]: unknown;
}

/** registry 包元数据中本流程消费的字段 */
interface RegistryMeta {
	"dist-tags": Record<string, string>;
	versions: Record<string, { dist?: { tarball?: string } }>;
}

/** fetch 请求非 2xx 时抛出的错误，携带 HTTP 状态码与状态文本 */
class HttpError extends Error {
	status: number;
	statusText: string;
	constructor(status: number, statusText: string) {
		super(`HTTP ${status} ${statusText}`);
		this.status = status;
		this.statusText = statusText;
	}
}

// 命令行参数（顶层解析；无副作用，单测导入本文件不会触发主流程）
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
}) as Args;

/** 项目目录名（rootDir 的最后一段，写入生成项目的 package.json 的 name） */
let project: string;
/** 目标目录的绝对路径（由用户输入的项目名拼接 cwd 得到） */
let rootDir: string;

// 执行脚手架时所在的工作目录，作为项目目录的基准
const cwd = process.cwd();

/**
 * 探测后续安装/启动使用的包管理器（Bun-first）：yarn / pnpm 用户跟随其
 * 生态习惯；其余场景（npm、bun 及探测不到 user-agent）一律走 bun——
 * 本 CLI 自身以 bun 为运行时（bin shebang），能执行即已具备 bun 环境。
 */
export function detectAgent(): string {
	const ua = process.env["npm_config_user_agent"] ?? "";
	if (ua.startsWith("yarn")) return "yarn";
	if (ua.startsWith("pnpm")) return "pnpm";
	return "bun";
}

/**
 * 从单个 .npmrc 文件提取 registry 配置项（非注释、非 scoped 的 registry= 行）。
 * 文件不存在或未配置时返回 undefined，读文件异常一律静默吞掉。
 */
export function readNpmrcRegistry(file: string): string | undefined {
	try {
		for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
			const matched = /^\s*registry\s*=\s*(\S+)\s*$/.exec(line);
			const value = matched?.[1];
			if (value) return value;
		}
	} catch {
		// registry 探测不允许打断主流程，任何读取失败都视为未配置
	}
	return undefined;
}

/**
 * 读取本机 npm registry 配置（优先级对齐 npm 自身：环境变量 > 项目
 * .npmrc > 用户 ~/.npmrc）。刻意不 spawn 子进程探测——既有实现按
 * user-agent 选 `bun config get registry`，而 Bun 没有 config 子命令，
 * bunx 场景下子进程退出码 1 直接炸掉脚手架；读 npmrc 是零依赖、零
 * 子进程的等价路径。任何一步都拿不到时返回 undefined，由调用方回落
 * 官方源。
 */
export function getLocalRegistry(
	cwd: string = process.cwd(),
	userHome: string = homedir(),
): string | undefined {
	const candidates = [
		process.env["npm_config_registry"],
		readNpmrcRegistry(join(cwd, ".npmrc")),
		readNpmrcRegistry(join(userHome, ".npmrc")),
	];
	for (const candidate of candidates) {
		if (candidate?.startsWith("https://") || candidate?.startsWith("http://")) {
			return candidate;
		}
	}
	return undefined;
}

/** 静默执行命令探测其是否可用（如 git --version），失败即视为不可用 */
function supports(command: readonly string[]) {
	return (
		spawnSync(command[0] ?? "", command.slice(1), { stdio: "ignore" })
			.status === 0
	);
}

/** 读 git 全局配置单项（读不到 → 空串） */
function gitConfig(key: string): string {
	const res = spawnSync("git", ["config", "--get", key], { encoding: "utf8" });
	return res.status === 0 ? (res.stdout?.trim() ?? "") : "";
}

/**
 * 获取项目名：优先取第一个位置参数，否则交互式询问（默认 koishi-app）。
 * 用户取消或输入为空时直接退出（不强行兜底默认值）。
 */
async function getName(): Promise<string> {
	if (argv._[0]) return `${argv._[0]}`;
	const answer = (await prompts({
		type: "text",
		name: "name",
		message: "项目名：",
		initial: "koishi-app",
	})) as { name?: string };
	const trimmed = answer.name?.trim();
	if (!trimmed) process.exit(0);
	return trimmed;
}

/** 递归清空目录内容（目录本身保留）。 */
function emptyDir(root: string) {
	for (const file of readdirSync(root)) {
		rmSync(join(root, file), { recursive: true, force: true });
	}
}

/** 交互式确认框：返回用户是否选择了「是」（取消视为否） */
async function confirm(message: string) {
	const answer = (await prompts({
		type: "confirm",
		name: "yes",
		initial: true,
		message,
	})) as { yes?: boolean };
	return answer.yes === true;
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
 * 改写模板的 package.json（纯函数，导出供单测）：替换项目名、标记
 * private、版本归零。
 */
export function renderManifest(
	source: Manifest,
	project: string,
	prod: boolean,
): string {
	const meta: Manifest = { ...source };
	meta["name"] = project;
	meta["private"] = true;
	meta["version"] = "0.0.0";
	if (prod) {
		// https://github.com/koishijs/koishi/issues/994
		// 生产模式不借助 NODE_ENV 或 --production 标志，
		// 而是直接删掉 devDependencies 与 workspaces 字段。
		delete meta["workspaces"];
		delete meta["devDependencies"];
	}
	return `${JSON.stringify(meta, null, 2)}\n`;
}

/** 把改写结果写回生成项目的 package.json */
function writePackageJson() {
	const filename = join(rootDir, "package.json");
	const meta = JSON.parse(readFileSync(filename, "utf8")) as Manifest;
	writeFileSync(filename, renderManifest(meta, project, argv.prod === true));
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
 * 远程模板下载与解包（--template 指定时）：
 * 1. 拉取模板包元数据，按 dist-tags 解析目标版本（--ref，默认 latest）；
 * 2. 流式下载 tarball 并解包到目标目录（strip: 1 去掉包根目录层级），
 *    网络错误统一以 HttpError 提示后退出；
 * 3. 最后改写 package.json。
 */
async function scaffoldRemote(registry: string) {
	const template = argv.template as string;
	const ref = argv.ref || "latest";

	try {
		const metaRes = await fetch(`${registry}/${template}`);
		if (!metaRes.ok) throw new HttpError(metaRes.status, metaRes.statusText);
		const remote = (await metaRes.json()) as RegistryMeta;
		const version = remote["dist-tags"][ref];
		const url =
			version === undefined
				? undefined
				: remote.versions[version]?.dist?.tarball;
		if (url === undefined) {
			throw new HttpError(404, `模板 ${template}@${ref} 不存在`);
		}
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
			`${kleur.red("error")} 请求失败：HTTP ${err.status} ${err.statusText}`,
		);
		process.exit(1);
	}

	writePackageJson();
}

/**
 * 生成项目的主入口：默认写内置 @koishi-ce 模板（scaffoldBuiltin）；
 * --template <包名> 时改为从 npm registry 下载远程模板（scaffoldRemote），
 * registry 取值 --registry 参数 > 本机 npm 配置 > 官方源。
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
		await scaffoldRemote(registry);
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
