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
 * 模板全部以内嵌字符串常量随源码发布（无独立 template/ 目录），用法：
 *   koishi-scripts setup [name]                     # 交互式问询
 *   koishi-scripts setup --name=foo --desc=... --owner=Oppenheymu   # 非交互
 *
 * 问询项：① 包名（自动补 koishi-plugin- 前缀）② 描述 ③ GitHub 所有者
 * （默认值从兄弟项目的 repository 字段众数探测）。生成后 git init，
 * 不自动 commit、不自动 install——结束时打印后续步骤。
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
import { cwd, loadHostManifest } from "./index";

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

/** 模板里包名的占位符（渲染时替换为真实包名） */
const PLUGIN_NAME_TOKEN = "@@PLUGIN_NAME@@";

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
// 参数与问询
// ---------------------------------------------------------------------------

/** 解析 --key=value 形式的命令行参数。 */
export function parseFlags(argv: readonly string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (const arg of argv) {
		const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
		if (match?.[1] !== undefined && match[2] !== undefined) {
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
		if (slash < 0 || !/^@[a-z0-9-]+$/.test(name.slice(0, slash))) {
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
	return body.length > 0 && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(body);
}

/** 由包名推导目录名（也是插件短名）：@scope/koishi-plugin-x → x。 */
export function deriveDirname(name: string): string {
	const pkg = name.includes("/") ? (name.split("/")[1] ?? name) : name;
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
		for (const entry of readdirSync(externalDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const manifestPath = join(externalDir, entry.name, "package.json");
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
				counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
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
	const res = spawnSync("git", ["config", "--get", key], { encoding: "utf8" });
	return res.status === 0 ? (res.stdout?.trim() ?? "") : "";
}

/**
 * 汇总问询答案。--name 给定时视为完全非交互：缺省字段静默取默认值
 * （desc 空、owner 走兄弟项目探测）；否则交互式逐项问询（需 TTY）。
 */
async function resolveAnswers(flags: Record<string, string>): Promise<Answers> {
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
		const owner = ownerInput.trim() !== "" ? ownerInput.trim() : detected;
		return { name, dirname: deriveDirname(name), desc: desc.trim(), owner };
	};

	if (flags["name"] !== undefined) {
		return finish(flags["name"], flags["desc"] ?? "", flags["owner"] ?? "");
	}

	if (!process.stdin.isTTY) {
		throw new Error(
			"非交互环境下必须提供 --name=<包名>（可选 --desc= --owner=）",
		);
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const rawName = await rl.question(
			"📦 包名（可省略 koishi-plugin- 前缀）：",
		);
		const desc = await rl.question("📝 描述（可选）：");
		const ownerHint = detected !== "" ? `（回车 = ${detected}）` : "";
		const owner = await rl.question(`🐙 GitHub 所有者${ownerHint}：`);
		return finish(rawName, desc, owner);
	} finally {
		rl.close();
	}
}

// ---------------------------------------------------------------------------
// 模板：项目清单
// ---------------------------------------------------------------------------

/** 相对路径写入（按需建目录，统一 LF 结尾）。 */
function writeFileRel(dir: string, relPath: string, content: string): void {
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
	const description = a.desc !== "" ? a.desc : "一个 Koishi 插件";
	const hasRepo = a.owner !== "";
	const repository = hasRepo
		? { type: "git", url: `git+https://github.com/${a.owner}/${a.name}.git` }
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
				? { "@koishijs/plugin-console": versions["@koishijs/plugin-console"] }
				: {}),
		},
		devDependencies: {
			...DEV_DEPENDENCIES,
			...(options.console
				? { "@koishijs/client": versions["@koishijs/client"] }
				: {}),
		},
		koishi: {
			description: { en: description, zh: description },
			service: {},
		},
	};
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** monorepo 形态的仓库根 package.json（根级 changesets + foreach 编排）。 */
function renderRootPackageJson(a: Answers, author: string): string {
	const description = a.desc !== "" ? a.desc : "一个 Koishi 插件集合";
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
			build: "yarn workspaces foreach -A run build",
			changeset: "changeset",
			version: "changeset version",
			release:
				"changeset version && yarn workspaces foreach -A run build && changeset publish",
		},
		devDependencies: { ...DEV_DEPENDENCIES },
	};
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// 模板：TS / 构建 / lint 配置
// ---------------------------------------------------------------------------

/** 单包项目的 tsconfig（独立工程，NodeNext 解析 + strict 全家桶）。 */
const TSCONFIG_JSON = `{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2025",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "moduleDetection": "force",
    "lib": [
      "ES2025"
    ],
    "types": [
      "node"
    ],
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": [
    "src"
  ]
}
`;

/** monorepo 形态的仓库根 tsconfig.base（无 include，由各子包继承）。 */
const TSCONFIG_BASE_JSON = `{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2025",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "moduleDetection": "force",
    "lib": [
      "ES2025"
    ],
    "types": [
      "node"
    ],
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  }
}
`;

/** monorepo 形态的仓库根 tsconfig（koishi-plugin-* 的 paths 映射，供编辑器解析包间源码引用）。 */
function renderRootTsConfig(a: Answers): string {
	return `${JSON.stringify(
		{
			extends: "./tsconfig.base",
			compilerOptions: {
				baseUrl: ".",
				paths: {
					[`koishi-plugin-${a.dirname}-*`]: ["packages/*/src"],
					"koishi-plugin-*": ["packages/*/src"],
				},
			},
		},
		null,
		2,
	)}\n`;
}

/** monorepo 形态的子包 tsconfig（继承仓库根 base）。 */
const PACKAGE_TSCONFIG_JSON = `{
  "extends": "../../tsconfig.base",
  "include": [
    "src"
  ]
}
`;

/** 生成项目的 tsdown 配置：源码 ESM，产物 CJS（.cjs），koishi 生态 dts 外部化。 */
const TSDOWN_CONFIG_TS = `import { defineConfig } from "tsdown";

// 源码保持 ESM（package.json 为 type:module，tsconfig/编辑器按 ESM 解析）；
// 构建产物固定为 CJS（.cjs 扩展名）：Node 宿主的 loader 用 require() 加载插件，
// Bun 宿主的 require(esm) 对 CJS 同样兼容，CJS 是两类宿主的最大公约数。
const outExtensions = () => ({ js: ".cjs", dts: ".d.ts" });

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "lib",
    dts: true,
    format: "cjs",
    platform: "node",
    outExtensions,
    clean: true,
    deps: {
        // 依赖全部 external（koishi 为 peer 单实例），不打进产物。
        bundle: false,
        dts: {
            // koishi 生态 d.ts 用 CJS dts 语法（export = Element）或 namespace 成员
            // re-export，dts 打包无法解析 → 生成 d.ts 时保持外部引用
            // （产物 d.ts 保留 import，消费端由 koishi 提供类型）。
            neverBundle: [/^koishi/, /^@satorijs\\//, /^@koishijs\\//, /^cordis/, /^minato/, /^cosmokit/],
        },
    },
});
`;

/** 生成项目的 biome 配置（4 空格 / 行宽 100 / 双引号）。 */
const BIOME_JSON = `{
    "$schema": "https://biomejs.dev/schemas/2.5.10/schema.json",
    "vcs": {
        "enabled": true,
        "clientKind": "git",
        "useIgnoreFile": true
    },
    "files": {
        "includes": ["**/src/**"]
    },
    "formatter": {
        "indentStyle": "space",
        "indentWidth": 4,
        "lineWidth": 100,
        "lineEnding": "lf"
    },
    "javascript": {
        "formatter": {
            "quoteStyle": "double",
            "trailingCommas": "all"
        }
    },
    "linter": {
        "enabled": true,
        "rules": {
            "recommended": true,
            "nursery": {
                "noFloatingPromises": "error"
            }
        }
    },
    "assist": {
        "actions": {
            "source": {
                "organizeImports": "on"
            }
        }
    }
}
`;

/** monorepo 形态的根 biome 配置（覆盖全部子包的 src 目录）。 */
const ROOT_BIOME_JSON = `{
    "$schema": "https://biomejs.dev/schemas/2.5.10/schema.json",
    "vcs": {
        "enabled": true,
        "clientKind": "git",
        "useIgnoreFile": true
    },
    "files": {
        "includes": ["packages/*/src/**"]
    },
    "formatter": {
        "indentStyle": "space",
        "indentWidth": 4,
        "lineWidth": 100,
        "lineEnding": "lf"
    },
    "javascript": {
        "formatter": {
            "quoteStyle": "double",
            "trailingCommas": "all"
        }
    },
    "linter": {
        "enabled": true,
        "rules": {
            "recommended": true,
            "nursery": {
                "noFloatingPromises": "error"
            }
        }
    },
    "assist": {
        "actions": {
            "source": {
                "organizeImports": "on"
            }
        }
    }
}
`;

// ---------------------------------------------------------------------------
// 模板：源码与文档
// ---------------------------------------------------------------------------

/** 插件入口模板（--console 用 console 变体，注册控制台扩展页面入口）。 */
function renderSrcIndex(a: Answers, consoleForm: boolean): string {
	const head = `import { type Context, Schema } from "koishi";

export const name = "${a.dirname}";

export type Config = Record<string, never>;

export const Config: Schema<Config> = Schema.object({});
`;
	if (!consoleForm) {
		return `${head}
export function apply(ctx: Context, _config: Config) {
    ctx.logger("${a.dirname}").info("插件已加载");
}
`;
	}
	return `${head}
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 源码是 ESM，用 import.meta.url 定位；构建为 CJS 后 rolldown 的
// import.meta.url 垫片指向产物文件，../client 仍落在项目根的 client/。
const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../client");

export function apply(ctx: Context, _config: Config) {
    ctx.inject(["console"], (ctx) => {
        ctx.console.addEntry({
            dev: resolve(clientRoot, "index.ts"),
            prod: resolve(clientRoot, "../dist"),
        });
    });
}
`;
}

/** 控制台前端扩展入口（依赖宿主 console 的 vite 管线与 unocss virtual module）。 */
const CLIENT_INDEX_TS = `import type { Context } from "@koishijs/client";
import Page from "./page.vue";

import "virtual:uno.css";

export default (ctx: Context) => {
    ctx.page({
        name: "扩展页面",
        path: "/custom-page",
        component: Page,
    });
};
`;

/** 控制台扩展示例页面（k-layout 为宿主 console 全局组件）。 */
const CLIENT_PAGE_VUE = `<template>
  <k-layout>扩展内容</k-layout>
</template>
`;

/** 控制台前端独立 tsconfig（types 用上游名 @koishijs/client/global）。 */
const CLIENT_TSCONFIG_JSON = `{
    "compilerOptions": {
        "rootDir": ".",
        "module": "esnext",
        "moduleResolution": "bundler",
        "jsx": "preserve",
        "noEmit": true,
        "skipLibCheck": true,
        "strict": true,
        "types": ["@koishijs/client/global"]
    },
    "include": ["."]
}
`;

const GITIGNORE = `lib
dist

node_modules
npm-debug.log
yarn-debug.log
yarn-error.log
tsconfig.tsbuildinfo

.DS_Store
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
`;

const EDITORCONFIG = `root = true

[*]
insert_final_newline = true
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
`;

const GITATTRIBUTES = `* text eol=lf

*.png -text
*.jpg -text
*.ico -text
*.gif -text
*.webp -text
`;

function renderReadme(a: Answers, monorepo: boolean): string {
	const desc = a.desc !== "" ? a.desc : "（待补充项目简介）";
	const check = monorepo
		? `yarn build      # 根级 foreach 构建全部子包（产物 packages/*/lib/index.cjs）
yarn workspace ${a.name} check   # 单包门禁：biome + 类型检查`
		: `yarn check      # 门禁：biome + 类型检查
yarn build      # 构建（产物 lib/index.cjs）`;
	return `# ${a.name}

[![npm](https://img.shields.io/npm/v/${a.name}?style=flat-square)](https://www.npmjs.com/package/${a.name})

${desc}

## 开发

\`\`\`bash
yarn install    # 在宿主工作区根目录执行一次（workspace 成员依赖提升）
${check}
\`\`\`

约定详见 \`AGENTS.md\`。
`;
}

function renderLicense(author: string): string {
	const year = new Date().getFullYear();
	// 剥离全部 <...> 邮箱段：[^>] 防跨段吞并，g 防多段残留
	const holder = author.replace(/\s*<[^>]*>/g, "").trim() || "（作者名）";
	return `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function renderChangesetConfig(branch: string): string {
	return `${JSON.stringify(
		{
			$schema: "https://unpkg.com/@changesets/config@3.0.0/schema.json",
			changelog: false,
			commit: false,
			fixed: [],
			linked: [],
			access: "public",
			baseBranch: branch,
			updateInternalDependencies: "patch",
		},
		null,
		4,
	)}\n`;
}

/** changesets 说明（发版命令按单包 / monorepo 根区分）。 */
function renderChangesetReadme(monorepo: boolean): string {
	const release = monorepo
		? "yarn release        # changeset version → foreach build → changeset publish"
		: "yarn release        # changeset version → tsdown → npm publish";
	return `# Changesets

每次完成一批用户可见改动（feat / fix / refactor 涉及发布内容），**必须随改动一起**
在本目录写 changeset 并提交，不要攒到发版前——攒必漏。

## 写法

手写 \`.changeset/<名字>.md\`：

\`\`\`md
---
"${PLUGIN_NAME_TOKEN}": patch
---

fix: 简体中文说明改动内容
\`\`\`

或运行 \`yarn changeset\` 交互式创建。

## bump 类型（0.x 阶段，API 未冻结）

- API 破坏 → minor（\`0.1.x → 0.2.x\`）
- 修复 → patch（\`0.0.x\`）
- 纯 chore（文档、CI、格式化等无行为变化）→ 不需要 changeset

## 发版

\`\`\`bash
${release}
\`\`\`
`;
}

function renderAgentsMd(a: Answers, monorepo: boolean): string {
	const desc = a.desc !== "" ? a.desc : "Koishi 插件";
	const form = monorepo ? "，monorepo 插件集合" : "";
	const workflow = monorepo
		? `\`\`\`bash
yarn build        # 根级：foreach 构建全部子包（产物 packages/*/lib/index.cjs）
yarn version      # 根级：消费 .changeset/ 条目、升版本号、写 CHANGELOG
yarn release      # 根级：version → build → changeset publish
yarn workspace ${a.name} check    # 单包门禁：biome check + ts7 类型检查（提交前必跑）
\`\`\`

- 包间引用走 workspace:* 协议；仓库根 tsconfig.json 配置了 \`koishi-plugin-*\`
  → \`packages/*/src\` 的 paths 映射，编辑器可直接跳转子包源码。
- 门禁全绿才提交；逐功能小步提交。`
		: `\`\`\`bash
yarn check        # 门禁：biome check + ts7 类型检查（提交前必跑）
yarn fix          # biome 自动修复 + 类型检查
yarn build        # tsdown 构建，产物 lib/index.cjs（Koishi loader 用 require 加载 CJS）
yarn typecheck    # 仅类型检查
\`\`\`

- 门禁全绿才提交；逐功能小步提交。
- 新增 locales yml 时参考兄弟项目做法（Bun 运行时原生支持 yml 导入）。`;
	const body = `# 项目常驻指令

> 本文件是本仓库（${PLUGIN_NAME_TOKEN}，${desc}${form}）的常驻开发约定。技术栈：TypeScript 7（@typescript/native）+ tsdown + biome + Changesets，开发环境为宿主工作区（external/ 下，依赖由工作区根提升提供，项目内无需 install）。

## 基本约束

- **全程使用简体中文**：回复、代码注释、提交说明、文档均用简体中文。
- **参考兄弟项目**：宿主工作区 external/ 下其它插件是现成范式，拿不准的写法先看它们。

## 工作流与门禁

${workflow}

- 构建产物固定 **CJS（.cjs 扩展名）**，源码保持 ESM；Koishi 的 loader 用 require 加载插件。
- 依赖只声明用到的：koishi 走 peerDependencies；开发工具进 devDependencies 并同步到宿主工作区根安装。

## 代码风格（biome 已强制）

- 4 空格缩进、行宽 100、双引号、尾逗号 all、LF。
- 类型安全：strict 全家桶、\`noUncheckedIndexedAccess\`、\`exactOptionalPropertyTypes\`、\`verbatimModuleSyntax\`、\`erasableSyntaxOnly\`（禁止 enum 与构造器参数属性，用 const 对象 + 联合类型替代）。
- 类型导入一律 \`import type\`；相对导入按 NodeNext 带 \`.js\` 后缀。
- 异步调用必须 await 或显式 void/\`.catch\`（\`noFloatingPromises\` 为 error）。

## Changesets 工作流（强制，勿攒）

- 每次用户可见改动随提交在 \`.changeset/\` 写条目，不要攒到发版前——攒必漏。
- **已知坑**：全新仓库在首次 commit 之前 \`changeset status\` 会报 "Failed to find where HEAD diverged from <分支>"——先做初始提交即可。
- 手写模板：

  \`\`\`md
  ---
  "${PLUGIN_NAME_TOKEN}": patch
  ---

  fix: ……（简体中文说明）
  \`\`\`

- bump 类型（0.x 阶段）：API 破坏 → minor，修复 → patch；纯 chore 不需要。
- 发版：${monorepo ? "仓库根 `yarn release`（version → build → changeset publish）" : "`yarn release`（version → build → npm publish）"}；发不出先查 \`.changeset/\` 是否有 pending 条目。

## git 提交流程

1. 先跑门禁确认全绿再提交。
2. \`git add -A\` 后提交，简体中文提交信息（\`feat:\` / \`fix:\` / \`docs:\` / \`chore:\`）。
3. 主分支直提；完成后向用户简要说明改动与提交哈希。
`;
	return body.split(PLUGIN_NAME_TOKEN).join(a.name);
}

// ---------------------------------------------------------------------------
// 写盘与主流程
// ---------------------------------------------------------------------------

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
		renderPackageJson(a, versions, author, options, isMember),
	);
	writeFileRel(
		targetDir,
		"tsconfig.json",
		isMember ? PACKAGE_TSCONFIG_JSON : TSCONFIG_JSON,
	);
	writeFileRel(targetDir, "tsdown.config.ts", TSDOWN_CONFIG_TS);
	writeFileRel(
		targetDir,
		join("src", "index.ts"),
		renderSrcIndex(a, options.console),
	);
	if (options.console) {
		writeFileRel(targetDir, join("client", "index.ts"), CLIENT_INDEX_TS);
		writeFileRel(targetDir, join("client", "page.vue"), CLIENT_PAGE_VUE);
		writeFileRel(
			targetDir,
			join("client", "tsconfig.json"),
			CLIENT_TSCONFIG_JSON,
		);
	}
}

/** 生成 monorepo 形态的仓库根文件。 */
function writeMonorepoRootFiles(
	monorepoDir: string,
	a: Answers,
	author: string,
	branch: string,
): void {
	writeFileRel(monorepoDir, "package.json", renderRootPackageJson(a, author));
	writeFileRel(monorepoDir, "tsconfig.base.json", TSCONFIG_BASE_JSON);
	writeFileRel(monorepoDir, "tsconfig.json", renderRootTsConfig(a));
	writeFileRel(monorepoDir, "biome.json", ROOT_BIOME_JSON);
	writeFileRel(
		monorepoDir,
		join(".changeset", "config.json"),
		renderChangesetConfig(branch),
	);
	writeFileRel(
		monorepoDir,
		join(".changeset", "README.md"),
		renderChangesetReadme(true),
	);
	writeFileRel(monorepoDir, "AGENTS.md", renderAgentsMd(a, true));
	writeFileRel(monorepoDir, ".gitignore", GITIGNORE);
	writeFileRel(monorepoDir, ".editorconfig", EDITORCONFIG);
	writeFileRel(monorepoDir, ".gitattributes", GITATTRIBUTES);
	writeFileRel(monorepoDir, "readme.md", renderReadme(a, true));
	writeFileRel(monorepoDir, "LICENSE", renderLicense(author));
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
		monorepo: args.includes("--monorepo") || args.includes("-m"),
		console: args.includes("--console") || args.includes("-c"),
	};
	const answers = await resolveAnswers(flags);

	// monorepo：仓库根 external/<dirname>/，插件包在 packages/<dirname>/
	const rootDir = join(cwd, "external");
	const targetDir = options.monorepo
		? join(rootDir, answers.dirname, "packages", answers.dirname)
		: join(rootDir, answers.dirname);
	const workspaceDir = options.monorepo
		? join(rootDir, answers.dirname)
		: targetDir;
	if (existsSync(workspaceDir) && readdirSync(workspaceDir).length > 0) {
		throw new Error(`目标目录已存在且非空：external/${answers.dirname}`);
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
		koishi: host?.dependencies?.["koishi"] ?? FALLBACK_VERSIONS.koishi,
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
		writeMonorepoRootFiles(projectDir, answers, authorLine, branch);
		writePackageFiles(targetDir, answers, versions, authorLine, options, true);
	} else {
		writePackageFiles(targetDir, answers, versions, authorLine, options, false);
		writeFileRel(targetDir, "biome.json", BIOME_JSON);
		writeFileRel(
			targetDir,
			join(".changeset", "config.json"),
			renderChangesetConfig(branch),
		);
		writeFileRel(
			targetDir,
			join(".changeset", "README.md"),
			renderChangesetReadme(false),
		);
		writeFileRel(targetDir, "AGENTS.md", renderAgentsMd(answers, false));
		writeFileRel(targetDir, ".gitignore", GITIGNORE);
		writeFileRel(targetDir, ".editorconfig", EDITORCONFIG);
		writeFileRel(targetDir, ".gitattributes", GITATTRIBUTES);
		writeFileRel(targetDir, "readme.md", renderReadme(answers, false));
		writeFileRel(targetDir, "LICENSE", renderLicense(authorLine));
	}

	const gitInit = spawnSync("git", ["init", "-b", branch], { cwd: projectDir });
	console.log(
		gitInit.status === 0
			? `[setup] ✅ 已初始化 git 仓库（分支 ${branch}）`
			: "[setup] ⚠️ git init 失败（不影响脚手架文件）",
	);

	console.log(`
[setup] 🎉 完成！后续步骤：
  1. cd ${projectDir.slice(cwd.length + 1) || projectDir}
  2. 在宿主工作区根执行 yarn install（注册 workspace 依赖到 lockfile）
  3. ${options.monorepo ? `yarn build && yarn workspace ${answers.name} check` : "yarn check && yarn build"} 验证门禁
  4. 没有 remote 时自行创建 GitHub 仓库并 git remote add origin …
  5. 开始写代码；用户可见改动随提交写 changeset（见 AGENTS.md）`);
	return 0;
}
