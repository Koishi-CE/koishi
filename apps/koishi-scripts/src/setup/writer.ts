// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * setup 的写盘层：把清单渲染结果与模板文件落到目标目录。单包根与
 * monorepo 根的附加文件收敛为 writeRootFiles 的 variant 参数（差异只有
 * 模板子目录与 monorepo 专属的根清单 / 两级 tsconfig），共通部分只写
 * 一份；单包 / monorepo 子包的插件本体文件走 writePackageFiles。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Answers } from "./answers.ts";
import type {
	SetupOptions,
	Versions,
} from "./manifests.ts";
import {
	renderPackageJson,
	renderRootPackageJson,
} from "./manifests.ts";
import {
	licenseHolder,
	readTemplate,
	renderTemplate,
} from "./template-io.ts";

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

/**
 * 生成单包形态的全部文件（也用于 monorepo 的 packages/<name>/ 子包，
 * isMember=true 时省略 workspaces 字段——changesets 根由仓库根承担）。
 */
export function writePackageFiles(
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
 * 生成仓库根附加文件（biome / changesets / 文档 / 许可证等）。variant
 * 决定模板子目录；monorepo 根额外写根 package.json 与 tsconfig.base /
 * tsconfig（单包根的 package.json 由 writePackageFiles 承担）。
 */
export function writeRootFiles(
	dir: string,
	a: Answers,
	author: string,
	branch: string,
	variant: "single" | "monorepo",
): void {
	if (variant === "monorepo") {
		writeFileRel(
			dir,
			"package.json",
			renderRootPackageJson(a, author),
		);
		writeFileRel(
			dir,
			"tsconfig.base.json",
			readTemplate(variant, "tsconfig.base.json"),
		);
		writeFileRel(
			dir,
			"tsconfig.json",
			renderTemplate(
				readTemplate(variant, "tsconfig.json"),
				{
					DIRNAME: a.dirname,
				},
			),
		);
	}
	writeFileRel(
		dir,
		"biome.json",
		readTemplate(variant, "biome.json.tpl"),
	);
	writeFileRel(
		dir,
		join(".changeset", "config.json"),
		renderTemplate(
			readTemplate("shared", "changeset-config.json"),
			{
				BRANCH: branch,
			},
		),
	);
	writeFileRel(
		dir,
		join(".changeset", "README.md"),
		renderTemplate(
			readTemplate(variant, "changeset-readme.md"),
			{
				PKG_NAME: a.name,
			},
		),
	);
	writeFileRel(
		dir,
		"AGENTS.md",
		renderTemplate(readTemplate(variant, "AGENTS.md"), {
			PKG_NAME: a.name,
			DESC: a.desc !== "" ? a.desc : "Koishi 插件",
		}),
	);
	for (const dotfile of [
		"gitignore",
		"editorconfig",
		"gitattributes",
	]) {
		writeFileRel(
			dir,
			`.${dotfile}`,
			readTemplate("shared", dotfile),
		);
	}
	writeFileRel(
		dir,
		"readme.md",
		renderTemplate(readTemplate(variant, "readme.md"), {
			PKG_NAME: a.name,
			DESC: a.desc !== "" ? a.desc : "（待补充项目简介）",
		}),
	);
	writeFileRel(
		dir,
		"LICENSE",
		renderTemplate(readTemplate("shared", "license"), {
			YEAR: `${new Date().getFullYear()}`,
			HOLDER: licenseHolder(author),
		}),
	);
}
