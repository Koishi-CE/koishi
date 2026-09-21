// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 编辑器的语言注册表：文件 → 语法高亮语言。
 *
 * 每一项的 `load` 都是动态 import，rolldown 会为每个语言切出独立 chunk——
 * 只有真正打开该类型文件时才下载对应语法包，首屏与其它语言的代码互不牵连
 * （对照：monaco 时代打的是全量语言定义 + 约 9MB 的语言服务 worker，
 * 而本插件其实一直用 setModeConfiguration 把语言服务全关着）。
 *
 * 新增语言：装包后在 LANGUAGES 内追加一项即可，没有其它注册步骤。
 */

import {
	StreamLanguage,
	type StreamParser,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** 一个语言支持项：定位方式 + 惰性加载器。 */
export interface LanguageSpec {
	/** 状态栏显示名（status.vue 直接展示） */
	label: string;
	/** 命中的文件扩展名（小写、不含点） */
	extensions?: readonly string[];
	/** 命中的完整文件名（小写，用于 Dockerfile 这类无扩展名文件） */
	filenames?: readonly string[];
	/** 惰性加载：返回 CM6 语言扩展 */
	load: () => Promise<Extension>;
}

/** 用 CodeMirror 5 的流式解析器（legacy-modes）包装成 CM6 语言扩展。 */
const legacy = (
	load: () => Promise<StreamParser<unknown>>,
): (() => Promise<Extension>) => {
	return async () => StreamLanguage.define(await load());
};

/**
 * 支持的语言表（顺序即匹配顺序）。
 *
 * 只列 Koishi 目录里真正可能出现的文件类型；未命中一律回退纯文本。
 * 语言均取自官方维护的包，语义上与 monaco 的对应语言等价（这里要的
 * 只是词法着色，不需要语言服务）。
 */
const LANGUAGES: LanguageSpec[] = [
	{
		label: "JavaScript",
		extensions: ["js", "mjs", "cjs"],
		load: async () =>
			(
				await import("@codemirror/lang-javascript")
			).javascript(),
	},
	{
		label: "JSX",
		// .jsx 必须显式开启 jsx，否则标签语法会被当作比较运算解析
		extensions: ["jsx"],
		load: async () =>
			(
				await import("@codemirror/lang-javascript")
			).javascript({
				jsx: true,
			}),
	},
	{
		label: "TypeScript",
		// .ts 不能开 jsx：泛型箭头函数等写法会被误判为标签
		extensions: ["ts", "mts", "cts"],
		load: async () =>
			(
				await import("@codemirror/lang-javascript")
			).javascript({
				typescript: true,
			}),
	},
	{
		label: "TSX",
		extensions: ["tsx"],
		load: async () =>
			(
				await import("@codemirror/lang-javascript")
			).javascript({
				typescript: true,
				jsx: true,
			}),
	},
	{
		label: "JSON",
		extensions: ["json", "jsonc"],
		load: async () =>
			(await import("@codemirror/lang-json")).json(),
	},
	{
		label: "HTML",
		extensions: ["html", "htm"],
		load: async () =>
			(await import("@codemirror/lang-html")).html(),
	},
	{
		label: "XML",
		extensions: ["xml", "xsl", "xsd", "svg"],
		load: async () =>
			(await import("@codemirror/lang-xml")).xml(),
	},
	{
		label: "CSS",
		extensions: ["css"],
		load: async () =>
			(await import("@codemirror/lang-css")).css(),
	},
	{
		label: "SCSS",
		extensions: ["scss"],
		load: async () =>
			(await import("@codemirror/lang-sass")).sass({
				indented: false,
			}),
	},
	{
		label: "Sass",
		extensions: ["sass"],
		load: async () =>
			(await import("@codemirror/lang-sass")).sass({
				indented: true,
			}),
	},
	{
		label: "Less",
		extensions: ["less"],
		load: async () =>
			(await import("@codemirror/lang-less")).less(),
	},
	{
		label: "Markdown",
		extensions: ["md", "markdown"],
		load: async () =>
			(
				await import("@codemirror/lang-markdown")
			).markdown(),
	},
	{
		label: "YAML",
		extensions: ["yml", "yaml"],
		load: async () =>
			(await import("@codemirror/lang-yaml")).yaml(),
	},
	{
		label: "Python",
		extensions: ["py", "pyw", "pyi"],
		load: async () =>
			(await import("@codemirror/lang-python")).python(),
	},
	{
		label: "SQL",
		extensions: ["sql"],
		load: async () =>
			(await import("@codemirror/lang-sql")).sql(),
	},
	{
		label: "Java",
		extensions: ["java"],
		load: async () =>
			(await import("@codemirror/lang-java")).java(),
	},
	{
		label: "C/C++",
		extensions: [
			"c",
			"h",
			"cc",
			"cpp",
			"cxx",
			"hh",
			"hpp",
			"hxx",
		],
		load: async () =>
			(await import("@codemirror/lang-cpp")).cpp(),
	},
	{
		label: "Rust",
		extensions: ["rs"],
		load: async () =>
			(await import("@codemirror/lang-rust")).rust(),
	},
	{
		label: "Go",
		extensions: ["go"],
		load: async () =>
			(await import("@codemirror/lang-go")).go(),
	},
	{
		label: "PHP",
		extensions: ["php"],
		load: async () =>
			(await import("@codemirror/lang-php")).php(),
	},
	{
		label: "Vue",
		extensions: ["vue"],
		load: async () =>
			(await import("@codemirror/lang-vue")).vue(),
	},
	// 以下语言官方只提供 CodeMirror 5 的流式解析器（legacy-modes），
	// 经 StreamLanguage 包装后同样可用，仅词法着色
	{
		label: "Shell",
		extensions: ["sh", "bash", "zsh"],
		load: legacy(
			async () =>
				(
					await import(
						"@codemirror/legacy-modes/mode/shell"
					)
				).shell,
		),
	},
	{
		label: "PowerShell",
		extensions: ["ps1", "psm1", "psd1"],
		load: legacy(
			async () =>
				(
					await import(
						"@codemirror/legacy-modes/mode/powershell"
					)
				).powerShell,
		),
	},
	{
		label: "TOML",
		extensions: ["toml"],
		load: legacy(
			async () =>
				(await import("@codemirror/legacy-modes/mode/toml"))
					.toml,
		),
	},
	{
		label: "Dockerfile",
		extensions: ["dockerfile"],
		filenames: ["dockerfile"],
		load: legacy(
			async () =>
				(
					await import(
						"@codemirror/legacy-modes/mode/dockerfile"
					)
				).dockerFile,
		),
	},
	{
		label: "INI",
		// .env 之类无文件名主干的配置也归此语法（KEY=VALUE）
		extensions: ["ini", "properties", "cfg", "conf", "env"],
		load: legacy(
			async () =>
				(
					await import(
						"@codemirror/legacy-modes/mode/properties"
					)
				).properties,
		),
	},
	{
		label: "Diff",
		extensions: ["diff", "patch"],
		load: legacy(
			async () =>
				(await import("@codemirror/legacy-modes/mode/diff"))
					.diff,
		),
	},
];

/** 无匹配语言时的显示名。 */
export const PLAIN_TEXT = "Plain Text";

/**
 * 按文件名解析语言支持项：先按扩展名，再按完整文件名（如 Dockerfile），
 * 均未命中返回 undefined（调用方据此回退纯文本）。
 */
export function resolveLanguage(
	filename: string,
): LanguageSpec | undefined {
	// 只关心 basename：路径分隔符在 win32 / posix 两种形态下都可能出现
	const name = filename
		.slice(
			Math.max(
				filename.lastIndexOf("/"),
				filename.lastIndexOf("\\"),
			) + 1,
		)
		.toLowerCase();
	const index = name.lastIndexOf(".");
	// 以点开头的隐藏文件（如 .env）整串视为扩展名，故此处取点后的部分
	const extension =
		index === -1 ? "" : name.slice(index + 1);
	for (const spec of LANGUAGES) {
		if (extension && spec.extensions?.includes(extension))
			return spec;
		if (spec.filenames?.includes(name)) return spec;
	}
	return undefined;
}
