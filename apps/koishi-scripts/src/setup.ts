/**
 * `koishi-scripts setup` 子命令：按内置模板初始化一个新插件项目，
 * 产物落在宿主项目的 external/ 目录下。支持三种形态：
 * - 普通单包插件（默认）；
 * - monorepo 插件集合（--monorepo，额外生成仓库根配置与 paths 映射）；
 * - 带控制台前端扩展的插件（--console，追加 client/ 目录并补充
 *   @koishijs/client 与 @koishijs/plugin-console 依赖声明）。
 * 模板源文件位于本包 template/ 目录（面向终端用户，独立于仓库其余部分）。
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { CAC } from "cac";
import { copyFile, mkdir, readFile, readJson, writeFile } from "fs-extra";
import { blue, red } from "kleur";
import prompts from "prompts";
import { whichPMRuns } from "which-pm-runs";
import { cwd, meta, type PackageJson } from "./index";

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
 * 插件项目初始化器：负责名称规范化、目录规划与全部模板文件的生成。
 * 一次 setup 对应一个 Initiator 实例。
 */
class Initiator {
	/** 插件短名（去掉 koishi-plugin- 前缀与作用域后的名字） */
	name!: string;
	/** 插件描述（交互式询问得到） */
	desc!: string;
	/** 插件完整包名（含 koishi-plugin- 前缀，可带 @scope/ 作用域） */
	fullname!: string;
	/** monorepo 形态下的仓库根目录；非 monorepo 时保持未赋值 */
	monorepo!: string;
	/** 插件包目录（package.json 所在处） */
	target!: string;
	/** 模板源目录（本包发布时的 template/，下划线开头的文件为点文件模板） */
	source = resolve(__dirname, "../template");

	constructor(private options: Options) {}

	/**
	 * 初始化入口：完成名称校验与文件生成后，用当前包管理器安装依赖。
	 */
	async start(name: string) {
		await this.init(name);
		const agent = whichPMRuns()?.name || "npm";
		const args: string[] = agent === "yarn" ? [] : ["install"];
		execSync([agent, ...args].join(" "), { stdio: "inherit" });
	}

	/**
	 * 名称规范化与目录规划：
	 * - 小写化、下划线转连字符，非法字符直接报错退出；
	 * - 自动补全 / 去重 koishi-plugin- 前缀；
	 * - 依据 --monorepo 决定 target（monorepo 下位于 external/<name>/packages/<name>）。
	 */
	async init(name: string) {
		name ||= await this.getName();
		const oldName = name;
		name = name.toLowerCase().replace(/_/g, "-");
		if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name)) {
			console.log(red("error"), "plugin name contains invalid character");
			process.exit(1);
		}
		if (oldName !== name) {
			console.log(blue("info"), `plugin name will be converted to "${name}"`);
			const { confirm } = await prompts({
				type: "confirm",
				name: "confirm",
				message: "OK?",
			});
			if (!confirm) process.exit(0);
		}
		if (name.includes("koishi-plugin-")) {
			this.fullname = name;
			this.name = name.replace("koishi-plugin-", "").replace(/^@.+\//, "");
			console.log(blue("info"), 'prefix "koishi-plugin-" can be omitted');
		} else {
			this.name = name.replace(/^@.+\//, "");
			this.fullname = name.replace(/^(.+\/)?/, "$1koishi-plugin-");
		}
		this.desc = await this.getDesc();
		if (this.options.monorepo) {
			this.monorepo = resolve(cwd, "external", this.name);
			this.target = resolve(cwd, "external", this.name, "packages", this.name);
		} else {
			this.target = resolve(cwd, "external", this.name);
		}
		await this.write();
	}

	/** 交互式询问插件名（未通过参数提供时触发） */
	async getName() {
		const { name } = await prompts({
			type: "text",
			name: "name",
			message: "plugin name:",
		});
		return name.trim() as string;
	}

	/** 交互式询问插件描述 */
	async getDesc() {
		const { desc } = await prompts({
			type: "text",
			name: "desc",
			message: "description:",
		});
		return desc as string;
	}

	/** 创建目标目录并并行生成全部模板文件，最后按需初始化 git */
	async write() {
		await mkdir(this.target, { recursive: true });
		await Promise.all([
			this.writeManifest(),
			this.writeTsConfig(),
			this.writeIndex(),
			this.writeReadme(),
			this.writeClient(),
		]);
		await this.initGit();
	}

	/**
	 * 生成 package.json：monorepo 形态额外写一份仓库根清单（devDependencies
	 * 直接继承宿主项目）；插件包本体则按 --console 补充 @koishijs/client
	 * （devDependencies）与 @koishijs/plugin-console（peerDependencies），
	 * koishi 的 peer 版本号取自宿主项目，保证生成的插件与宿主生态兼容。
	 */
	async writeManifest() {
		if (this.monorepo) {
			const source: Partial<PackageJson> = await readJson(
				`${this.source}/package.root.json`,
				"utf8",
			);
			source.devDependencies = meta.devDependencies;
			await writeFile(
				`${this.monorepo}/package.json`,
				`${JSON.stringify(
					{
						name: `@root/${this.name}`,
						...source,
					},
					null,
					2,
				)}\n`,
			);
		}

		const source: Partial<PackageJson> = await readJson(
			`${this.source}/package.json`,
			"utf8",
		);
		source.devDependencies ??= {};
		source.peerDependencies ??= {};
		if (this.options.console) {
			source.devDependencies["@koishijs/client"] = meta.devDependencies?.[
				"@koishijs/client"
			] as string;
			source.peerDependencies["@koishijs/plugin-console"] = meta.dependencies?.[
				"@koishijs/plugin-console"
			] as string;
		}
		source.peerDependencies.koishi = meta.dependencies?.koishi as string;
		await writeFile(
			`${this.target}/package.json`,
			`${JSON.stringify(
				{
					name: this.fullname,
					description: this.desc,
					...source,
				},
				null,
				2,
			)}\n`,
		);
	}

	/**
	 * 生成 tsconfig：monorepo 形态写仓库根 tsconfig.base.json + 根
	 * tsconfig.json（含 koishi-plugin-* 的 paths 映射）+ 子包 tsconfig.json
	 * 三份；单包形态只写一份（继承模板的 base 配置）。
	 */
	async writeTsConfig() {
		const source = await readJson(`${this.source}/tsconfig.base.json`, "utf8");
		if (this.monorepo) {
			await writeFile(
				`${this.monorepo}/tsconfig.base.json`,
				JSON.stringify(source, null, 2),
			);
			await writeFile(
				`${this.monorepo}/tsconfig.json`,
				`${JSON.stringify(
					{
						extends: "./tsconfig.base",
						compilerOptions: {
							baseUrl: ".",
							paths: {
								[`koishi-plugin-${this.name}-*`]: ["packages/*/src"],
								"koishi-plugin-*": ["packages/*/src"],
							},
						},
					},
					null,
					2,
				)}\n`,
			);
			await writeFile(
				`${this.target}/tsconfig.json`,
				`${JSON.stringify(
					{
						extends: "../../tsconfig.base",
						compilerOptions: {
							outDir: "lib",
							rootDir: "src",
						},
						include: ["src"],
					},
					null,
					2,
				)}\n`,
			);
		} else {
			await writeFile(
				`${this.target}/tsconfig.json`,
				`${JSON.stringify(
					{
						...source,
						include: ["src"],
					},
					null,
					2,
				)}\n`,
			);
		}
	}

	/**
	 * 生成插件入口 src/index.ts：--console 用 console 模板（前端扩展），
	 * 否则用 default 模板（服务端插件），并把 {{name}} 占位符替换为短名。
	 */
	async writeIndex() {
		await mkdir(`${this.target}/src`);
		const filename = `/src/index.${this.options.console ? "console" : "default"}.ts`;
		const source = await readFile(this.source + filename, "utf8");
		await writeFile(
			`${this.target}/src/index.ts`,
			source.replace(/\{\{name\}\}/g, this.name.replace(/^@\w+\//, "")),
		);
	}

	/** 生成 readme.md：替换 {{name}} / {{desc}} 占位符 */
	async writeReadme() {
		const source = await readFile(`${this.source}/readme.md`, "utf8");
		await writeFile(
			`${this.target}/readme.md`,
			source
				.replace(/\{\{name\}\}/g, this.fullname)
				.replace(/\{\{desc\}\}/g, this.desc),
		);
	}

	/**
	 * 生成控制台前端扩展目录 client/（仅 --console 形态）：
	 * 入口 index.ts、示例页面 page.vue 与独立 tsconfig。
	 */
	async writeClient() {
		if (!this.options.console) return;
		await mkdir(`${this.target}/client`);
		// 三个文件互不依赖，并行拷贝
		await Promise.all([
			copyFile(
				`${this.source}/client/index.ts`,
				`${this.target}/client/index.ts`,
			),
			copyFile(
				`${this.source}/client/page.vue`,
				`${this.target}/client/page.vue`,
			),
			copyFile(
				`${this.source}/client/tsconfig.json`,
				`${this.target}/client/tsconfig.json`,
			),
		]);
	}

	/**
	 * 初始化 git 仓库：先拷贝编辑器/git 配置（模板中下划线开头的文件
	 * 重命名为点文件），再 init + add + 首次提交；--no-git 时跳过。
	 */
	async initGit() {
		if (!this.options.git || !supports("git --version")) return;
		// 三份配置文件互不依赖，并行拷贝
		await Promise.all([
			copyFile(`${this.source}/_editorconfig`, `${this.target}/.editorconfig`),
			copyFile(
				`${this.source}/_gitattributes`,
				`${this.target}/.gitattributes`,
			),
			copyFile(`${this.source}/_gitignore`, `${this.target}/.gitignore`),
		]);
		execSync("git init", { cwd: this.target, stdio: "ignore" });
		execSync("git add .", { cwd: this.target, stdio: "ignore" });
		execSync('git commit -m "initial commit"', {
			cwd: this.target,
			stdio: "ignore",
		});
	}
}

/** setup 命令的选项：--monorepo 生成插件集合，--console 附带前端扩展，--no-git 跳过 git 初始化 */
interface Options {
	monorepo?: boolean;
	console?: boolean;
	git?: boolean;
}

/**
 * 向 CAC 实例注册 setup 命令（create / init / new 均为其别名），
 * 行为全部委托给 Initiator。
 */
export default function (cli: CAC) {
	cli
		.command("setup [name]", "initialize a new plugin")
		.alias("create")
		.alias("init")
		.alias("new")
		.option("-m, --monorepo", "setup for monorepo")
		.option("-c, --console", "with console extension")
		.option("-G, --no-git", "skip git initialization")
		.action(async (name: string, options) => {
			new Initiator(options).start(name);
		});
}
