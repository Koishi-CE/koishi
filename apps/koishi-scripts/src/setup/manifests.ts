// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * setup 的项目清单渲染：package.json 的单包 / monorepo 子包 / monorepo
 * 仓库根三种形态，以及配套的版本常量（宿主清单缺失时兜底）。强结构化
 * 清单在此以字面量渲染；模板静态文本走 template-io。
 */
import type { Answers } from "./answers.ts";

/** koishi 生态依赖版本兜底（宿主清单缺失时使用；一律上游名，维持生态兼容） */
export const FALLBACK_VERSIONS = {
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
export function renderRootPackageJson(
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
