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
 * monorepo 共用、single/ 单包专属、monorepo/ 集合仓库根专属），本模块只做
 * 定位、@@TOKEN@@ 占位替换与写盘；package.json 等强结构化清单仍在此渲染。
 * 用法：
 *   koishi-scripts setup [name]                     # 交互式问询
 *   koishi-scripts setup --name=foo --desc=... --owner=Oppenheymu   # 非交互
 *
 * 问询项：① 包名（自动补 koishi-plugin- 前缀）② 描述 ③ GitHub 所有者
 * （默认值从兄弟项目的 repository 字段众数探测）。生成后 git init，
 * 不自动 commit、不自动 install——结束时打印后续步骤（包管理器一律 Bun）。
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { cwd, loadHostManifest } from "./index.ts";

/** koishi 生态依赖版本兜底（宿主清单缺失时使用；一律上游名，维持生态兼容） */
const FALLBACK_VERSIONS = {
	koishi: "^4.18.11",
	"@koishijs/client": "^5.30.4",
	"@koishijs/plugin-console": "^5.30.11",
} as const;

/** 生成项目的 devDependencies（工具链版本与仓库根对齐） */
const DEV_DEPENDENCIES = {
	"@biomejs/biome": "^2.5.10",
	"@changesets/cli": "^2.31.1",
	"@types/node": "^26.4.0",
	"@typescript/native": "npm:typescript@7.0.2",
	tsdown: "^0.22.14",
} as const;

/** koishi / console 相关依赖的最终版本号（宿主清单优先，兜底常量） */
export interface Versions {
	koishi: string;
	"@koishijs/client": string;
	"@koishijs/plugin-console": string;
}

/** 生成形态选项（--monorepo / --console） */
export interface SetupOptions {
	monorepo: boolean;
	console: boolean;
}

interface Answers {
	/** npm 包名（规范形如 koishi-plugin-foo 或 @scope/koishi-plugin-foo） */
	name: string;
	/** 目录名（去前缀，如 foo），同时是插件短名 */
	dirname: string;
	/** 一句话描述（可为空） */
	desc: string;
	/** GitHub 所有者（空 → 不写 homepage/repository 字段） */
	owner: string;
}

// ---------------------------------------------------------------------------
// 模板文件读取与渲染
// ----------------------------------------------------------------------------

/**
 * 定位内置模板目录：src 直跑（开发 / 测试）与 lib 产物（npm 消费）两种
 * 形态各按相对路径探测（发布包 files 含 src，lib 同级的 ../src/template
 * 恒存在）。
 */
function locateTemplateDir(): string {
	const base = dirname(fileURLToPath(import.meta.url));
	for (const dir of [
		join(base, "template"),
		join(base, "../src/template"),
	]) {
		if (existsSync(dir)) return dir;
	}
	throw new Error(
		"koishi-scripts 内置模板目录缺失（src/template）",
	);
}

const templateDir = locateTemplateDir();

/** 读取模板文件原文（相对模板目录的多段路径）。 */
function readTemplate(...segments: string[]): string {
	return readFileSync(
		join(templateDir, ...segments),
		"utf8",
	);
}

/**
 * 渲染模板：把 `@@KEY@@` 占位替换为给定值，未提供的占位原样保留
 * （写盘后的测试会断言产物不含 @@ 残留）。
 */
function renderTemplate(
	source: string,
	tokens: Record<string, string>,
): string {
	return source.replace(
		/@@([A-Z_]+)@@/g,
		(raw, key: string) =>
			Object.hasOwn(tokens, key)
				? (tokens[key] ?? raw)
				: raw,
	);
}

/**
 * 从 git 署名行提取许可证持有人名。截断而非剥离 <...> 段——后者对嵌套
 * 尖括号（如 `<<<>script>`）存在清洗绕过，会残留 `<script>` 标签
 * （CodeQL incomplete-multi-character-sanitization）。
 */
function licenseHolder(author: string): string {
	return (
		(author.split("<")[0] ?? "").trim() || "（作者名）"
	);
}

// ---------------------------------------------------------------------------
// 参数与问询
// ----------------------------------------------------------------------------

/** 解析 --key=value 形式的命令行参数。 */
export function parseFlags(
	argv: readonly string[],
): Record<string, string> {
	const flags: Record<string, string> = {};
	for (const arg of argv) {
		const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
		if (
			match?.[1] !== undefined &&
			match?.[2] !== undefined
		) {
			flags[match[1]] = match[2];
		}
	}
	return flags;
}

/**
 * 规范化包名：小写化、下划线转连字符；无论是否带 @scope，尾段缺
 * koishi-plugin- 前缀时自动补齐。
 */
export function normalizeName(raw: string): string | null {
	let name = raw.trim().toLowerCase().replace(/_/g, "-");
	if (name.startsWith("@")) {
		// @scope/koishi-plugin-x：scope 段校验 + 尾段自动补前缀
		const slash = name.indexOf("/");
		if (
			slash < 0 ||
			!/^@[a-z0-9-]+$/.test(name.slice(0, slash))
		) {
			return null;
		}
		const segment = name.slice(slash + 1);
		const prefixed = segment.startsWith("koishi-plugin-")
			? segment
			: `koishi-plugin-${segment}`;
		return isValidPluginSegment(prefixed)
			? `${name.slice(0, slash)}/${prefixed}`
			: null;
	}
	if (!name.startsWith("koishi-plugin-")) {
		name = `koishi-plugin-${name}`;
	}
	return isValidPluginSegment(name) ? name : null;
}

/** 校验包名尾段是否为合法 npm 名且带 koishi-plugin- 前缀。 */
function isValidPluginSegment(name: string): boolean {
	if (!name.startsWith("koishi-plugin-")) {
		return false;
	}
	const body = name.slice("koishi-plugin-".length);
	return (
		body.length > 0 &&
		/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(body)
	);
}

/** 由包名推导目录名（也是插件短名）：@scope/koishi-plugin-x → x。 */
export function deriveDirname(name: string): string {
	const pkg = name.includes("/")
		? (name.split("/")[1] ?? name)
		: name;
	return pkg.slice("koishi-plugin-".length);
}

/**
 * 从兄弟项目的 repository.url 探测 GitHub 所有者（取众数；宿主工作区内
 * 项目同属一个账号，新项目跟随即可，省一次问询输入）。
 */
function detectOwner(): string {
	const externalDir = join(cwd, "external");
	const counts = new Map<string, number>();
	try {
		for (const entry of readdirSync(externalDir, {
			withFileTypes: true,
		})) {
			if (!entry.isDirectory()) {
				continue;
			}
			const manifestPath = join(
				externalDir,
				entry.name,
				"package.json",
			);
			if (!existsSync(manifestPath)) {
				continue;
			}
			const url = (
				JSON.parse(readFileSync(manifestPath, "utf8")) as {
					repository?: { url?: string };
				}
			).repository?.url;
			const match =
				typeof url === "string"
					? /github\.com[:/]([A-Za-z0-9_-]+)\//.exec(url)
					: null;
			if (match?.[1] !== undefined) {
				counts.set(
					match[1],
					(counts.get(match[1]) ?? 0) + 1,
				);
			}
		}
	} catch {
		return "";
	}
	let best = "";
	let bestCount = 0;
	for (const [owner, count] of counts) {
		if (count > bestCount) {
			best = owner;
			bestCount = count;
		}
	}
	return bestCount >= 2 ? best : "";
}

/** 读 git 全局配置单项（读不到 → 空串）。 */
function gitConfig(key: string): string {
	const res = spawnSync("git", ["config", "--get", key], {
		encoding: "utf8",
	});
	return res.status === 0 ? (res.stdout?.trim() ?? "") : "";
}

/**
 * 汇总问询答案。--name 给定时视为完全非交互：缺省字段静默取默认值
 * （desc 空、owner 走兄弟项目探测）；否则交互式逐项问询（需 TTY）。
 */
async function resolveAnswers(
	flags: Record<string, string>,
): Promise<Answers> {
	const detected = detectOwner();
	const finish = (
		rawName: string,
		desc: string,
		ownerInput: string,
	): Answers => {
		const name = normalizeName(rawName);
		if (name === null) {
			throw new Error(`非法的包名：${rawName}`);
		}
		const owner =
			ownerInput.trim() !== ""
				? ownerInput.trim()
				: detected;
		return {
			name,
			dirname: deriveDirname(name),
			desc: desc.trim(),
			owner,
		};
	};

	if (flags["name"] !== undefined) {
		return finish(
			flags["name"],
			flags["desc"] ?? "",
			flags["owner"] ?? "",
		);
	}

	if (!process.stdin.isTTY) {
		throw new Error(
			"非交互环境下必须提供 --name=<包名>（可选 --desc= --owner=）",
		);
	}
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const rawName = await rl.question(
			"📦 包名（可省略 koishi-plugin- 前缀）：",
		);
		const desc = await rl.question("📝 描述（可选）：");
		const ownerHint =
			detected !== "" ? `（回车 = ${detected}）` : "";
		const owner = await rl.question(
			`🐙 GitHub 所有者${ownerHint}：`,
		);
		return finish(rawName, desc, owner);
	} finally {
		rl.close();
	}
}

// ---------------------------------------------------------------------------
// 模板：项目清单
// ----------------------------------------------------------------------------

/** 相对路径写入（按需建目录，统一 LF 结尾）。 */
function writeFileRel(
	dir: string,
	relPath: string,
	content: string,
): void {
	const fullPath = join(dir, relPath);
	mkdirSync(dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content, "utf8");
}

/** 渲染单包 / monorepo 子包共用的 package.json（导出供单测）。 */
export function renderPackageJson(
	a: Answers,
	versions: Versions,
	author: string,
	options: SetupOptions,
	isMember: boolean,
): string {
	const description =
		a.desc !== "" ? a.desc : "一个 Koishi 插件";
	const hasRepo = a.owner !== "";
	const repository = hasRepo
		? {
				type: "git",
				url: `git+https://github.com/${a.owner}/${a.name}.git`,
			}
		: undefined;
	const manifest: Record<string, unknown> = {
		$schema: "https://json.schemastore.org/package.json",
		name: a.name,
		version: "0.1.0",
		description,
		...(author !== "" ? { contributors: [author] } : {}),
		main: "lib/index.cjs",
		types: "lib/index.d.ts",
		exports: {
			".": {
				types: "./lib/index.d.ts",
				development: "./src/index.ts",
				default: "./lib/index.cjs",
			},
			"./package.json": "./package.json",
		},
		// console 形态的 prod 产物目录 dist 一并发布
		files: options.console ? ["lib", "dist"] : ["lib"],
		license: "MIT",
		type: "module",
		// 单包项目自封 workspace：根级 changesets 可解析到本包；
		// monorepo 子包不需要（changesets 根由仓库根承担）
		...(isMember ? {} : { workspaces: ["."] }),
		publishConfig: { access: "public" },
		...(hasRepo
			? {
					homepage: `https://github.com/${a.owner}/${a.name}#readme`,
					repository,
				}
			: {}),
		keywords: ["chatbot", "koishi", "plugin"],
		scripts: {
			build: "tsdown",
			typecheck: "tsc --noEmit",
			lint: "biome lint .",
			format: "biome format --write .",
			check: "biome check . && tsc --noEmit",
			fix: "biome check --write . && tsc --noEmit",
			// changesets 发版在单包根 / monorepo 仓库根进行，子包不重复声明
			...(isMember
				? {}
				: {
						changeset: "changeset",
						release:
							"changeset version && tsdown && npm publish --access public",
					}),
		},
		peerDependencies: {
			koishi: versions.koishi,
			...(options.console
				? {
						"@koishijs/plugin-console":
							versions["@koishijs/plugin-console"],
					}
				: {}),
		},
		devDependencies: {
			...DEV_DEPENDENCIES,
			...(options.console
				? {
						"@koishijs/client":
							versions["@koishijs/client"],
					}
				: {}),
		},
		koishi: {
			description: { en: description, zh: description },
			service: {},
		},
	};
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** monorepo 形态的仓库根 package.json（根级 changesets + --filter 编排）。 */
function renderRootPackageJson(
	a: Answers,
	author: string,
): string {
	const description =
		a.desc !== "" ? a.desc : "一个 Koishi 插件集合";
	const manifest: Record<string, unknown> = {
		$schema: "https://json.schemastore.org/package.json",
		name: `@root/${a.dirname}`,
		version: "0.1.0",
		description,
		...(author !== "" ? { contributors: [author] } : {}),
		private: true,
		license: "MIT",
		type: "module",
		workspaces: ["packages/*"],
		scripts: {
			// 包管理器一律 Bun：根级批量构建走 bun run --filter
			build: "bun run --filter './packages/*' build",
			changeset: "changeset",
			version: "changeset version",
			release:
				"changeset version && bun run --filter './packages/*' build && changeset publish",
		},
		devDependencies: { ...DEV_DEPENDENCIES },
	};
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// 写盘与主流程
// ----------------------------------------------------------------------------

/**
 * 生成单包形态的全部文件（也用于 monorepo 的 packages/<name>/ 子包，
 * isMember=true 时省略 workspaces 字段——changesets 根由仓库根承担）。
 */
function writePackageFiles(
	targetDir: string,
	a: Answers,
	versions: Versions,
	author: string,
	options: SetupOptions,
	isMember: boolean,
): void {
	writeFileRel(
		targetDir,
		"package.json",
		renderPackageJson(
			a,
			versions,
			author,
			options,
			isMember,
		),
	);
	writeFileRel(
		targetDir,
		"tsconfig.json",
		isMember
			? readTemplate("shared", "member", "tsconfig.json")
			: readTemplate("single", "tsconfig.json"),
	);
	writeFileRel(
		targetDir,
		"tsdown.config.ts",
		readTemplate("shared", "tsdown.config.ts"),
	);
	writeFileRel(
		targetDir,
		join("src", "index.ts"),
		renderTemplate(
			readTemplate(
				"shared",
				"src",
				options.console ? "index.console.ts" : "index.ts",
			),
			{ SHORTNAME: a.dirname },
		),
	);
	if (options.console) {
		writeFileRel(
			targetDir,
			join("client", "index.ts"),
			readTemplate("shared", "client", "index.ts"),
		);
		writeFileRel(
			targetDir,
			join("client", "page.vue"),
			readTemplate("shared", "client", "page.vue"),
		);
		writeFileRel(
			targetDir,
			join("client", "tsconfig.json"),
			readTemplate("shared", "client", "tsconfig.json"),
		);
	}
}

/**
 * 单包形态的仓库根附加文件（biome / changesets / 文档 / 许可证等，
 * monorepo 形态由 writeMonorepoRootFiles 承担）。
 */
function writeSingleRootFiles(
	targetDir: string,
	a: Answers,
	author: string,
	branch: string,
): void {
	writeFileRel(
		targetDir,
		"biome.json",
		readTemplate("single", "biome.json.tpl"),
	);
	writeFileRel(
		targetDir,
		join(".changeset", "config.json"),
		renderTemplate(
			readTemplate("shared", "changeset-config.json"),
			{
				BRANCH: branch,
			},
		),
	);
	writeFileRel(
		targetDir,
		join(".changeset", "README.md"),
		renderTemplate(
			readTemplate("single", "changeset-readme.md"),
			{
				PKG_NAME: a.name,
			},
		),
	);
	writeFileRel(
		targetDir,
		"AGENTS.md",
		renderTemplate(readTemplate("single", "AGENTS.md"), {
			PKG_NAME: a.name,
			DESC: a.desc !== "" ? a.desc : "Koishi 插件",
		}),
	);
	writeFileRel(
		targetDir,
		".gitignore",
		readTemplate("shared", "gitignore"),
	);
	writeFileRel(
		targetDir,
		".editorconfig",
		readTemplate("shared", "editorconfig"),
	);
	writeFileRel(
		targetDir,
		".gitattributes",
		readTemplate("shared", "gitattributes"),
	);
	writeFileRel(
		targetDir,
		"readme.md",
		renderTemplate(readTemplate("single", "readme.md"), {
			PKG_NAME: a.name,
			DESC: a.desc !== "" ? a.desc : "（待补充项目简介）",
		}),
	);
	writeFileRel(
		targetDir,
		"LICENSE",
		renderTemplate(readTemplate("shared", "license"), {
			YEAR: `${new Date().getFullYear()}`,
			HOLDER: licenseHolder(author),
		}),
	);
}

/** 生成 monorepo 形态的仓库根文件。 */
function writeMonorepoRootFiles(
	monorepoDir: string,
	a: Answers,
	author: string,
	branch: string,
): void {
	writeFileRel(
		monorepoDir,
		"package.json",
		renderRootPackageJson(a, author),
	);
	writeFileRel(
		monorepoDir,
		"tsconfig.base.json",
		readTemplate("monorepo", "tsconfig.base.json"),
	);
	writeFileRel(
		monorepoDir,
		"tsconfig.json",
		renderTemplate(
			readTemplate("monorepo", "tsconfig.json"),
			{
				DIRNAME: a.dirname,
			},
		),
	);
	writeFileRel(
		monorepoDir,
		"biome.json",
		readTemplate("monorepo", "biome.json.tpl"),
	);
	writeFileRel(
		monorepoDir,
		join(".changeset", "config.json"),
		renderTemplate(
			readTemplate("shared", "changeset-config.json"),
			{
				BRANCH: branch,
			},
		),
	);
	writeFileRel(
		monorepoDir,
		join(".changeset", "README.md"),
		renderTemplate(
			readTemplate("monorepo", "changeset-readme.md"),
			{
				PKG_NAME: a.name,
			},
		),
	);
	writeFileRel(
		monorepoDir,
		"AGENTS.md",
		renderTemplate(readTemplate("monorepo", "AGENTS.md"), {
			PKG_NAME: a.name,
			DESC: a.desc !== "" ? a.desc : "Koishi 插件",
		}),
	);
	writeFileRel(
		monorepoDir,
		".gitignore",
		readTemplate("shared", "gitignore"),
	);
	writeFileRel(
		monorepoDir,
		".editorconfig",
		readTemplate("shared", "editorconfig"),
	);
	writeFileRel(
		monorepoDir,
		".gitattributes",
		readTemplate("shared", "gitattributes"),
	);
	writeFileRel(
		monorepoDir,
		"readme.md",
		renderTemplate(readTemplate("monorepo", "readme.md"), {
			PKG_NAME: a.name,
			DESC: a.desc !== "" ? a.desc : "（待补充项目简介）",
		}),
	);
	writeFileRel(
		monorepoDir,
		"LICENSE",
		renderTemplate(readTemplate("shared", "license"), {
			YEAR: `${new Date().getFullYear()}`,
			HOLDER: licenseHolder(author),
		}),
	);
}

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
		writeMonorepoRootFiles(
			projectDir,
			answers,
			authorLine,
			branch,
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
		writeSingleRootFiles(
			targetDir,
			answers,
			authorLine,
			branch,
		);
	}

	const gitInit = spawnSync("git", ["init", "-b", branch], {
		cwd: projectDir,
	});
	console.log(
		gitInit.status === 0
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
