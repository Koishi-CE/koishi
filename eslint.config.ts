// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import tsParser from "@typescript-eslint/parser";
import type { Linter } from "eslint";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";

/**
 * 内联规则：.vue 模板表达式的类型断言纪律。
 *
 * 两个前置事实决定了实现形态：
 *   1. eslint 核心不遍历 templateBody（vue 官方规则可见模板，靠的是
 *      defineTemplateBodyVisitor 在 Program:exit 手动遍历）——本规则同样挂
 *      Program:exit 手动走模板树；
 *   2. 模板表达式由 vue-eslint-parser 按 espree 纯 JS 解析（parserOptions.parser
 *      只作用于 <script>），`as any` 这类 TS 语法解析失败回退为空容器——AST
 *      选择器命中不了，只能对容器原文做文本级匹配（容器节点在解析失败时依然
 *      存在，故连不可解析的指令表达式如 :foo="x as any" 也能覆盖）。
 *
 * script 内断言归 biome GritQL 插件管，此处天然不重叠。
 */
const templateCastPlugin: Linter.Plugin = {
	rules: {
		"template-no-cast": {
			meta: { schema: false },
			create(context) {
				const double = /\bas\s+(?:unknown|any)\s+as\b/;
				const asAny = /\bas\s+any\b/;
				const check = (node: {
					range: [number, number];
				}): void => {
					const text = context.sourceCode.text.slice(
						node.range[0],
						node.range[1],
					);
					if (double.test(text)) {
						context.report({
							node,
							message:
								"禁止 .vue 模板表达式内双重断言（as unknown as / as any as），请上移到 script 或重构类型",
						});
					} else if (asAny.test(text)) {
						context.report({
							node,
							message:
								"禁止 .vue 模板表达式内 as any（显式 any 的唯一逃逸口），请重构类型",
						});
					}
				};
				const visit = (
					node: unknown,
					depth: number,
				): void => {
					const record = node as {
						type?: string;
						range?: [number, number];
					};
					if (!record?.type || depth > 64) return;
					if (
						record.type === "VExpressionContainer" &&
						record.range
					)
						check(record as { range: [number, number] });
					for (const [key, value] of Object.entries(
						record,
					)) {
						if (
							key === "parent" ||
							key === "tokens" ||
							key === "comments" ||
							key === "loc" ||
							key === "range"
						)
							continue;
						if (Array.isArray(value))
							for (const child of value)
								visit(child, depth + 1);
						else if (
							value &&
							typeof value === "object" &&
							typeof (value as { type?: string }).type ===
								"string"
						)
							visit(value, depth + 1);
					}
				};
				return {
					"Program:exit"(node: { templateBody?: unknown }) {
						if (node.templateBody)
							visit(node.templateBody, 0);
					},
				};
			},
		},
	},
};

/**
 * eslint.config.ts —— 仅针对 *.vue，补 biome 覆盖不到的模板/组件语义检查。
 *
 * biome 不解析 .vue，本配置与 biome 零重叠。核心是 vue/no-undef-components。
 * 注意：@typescript-eslint/parser 目前只支持 TS <=6 的 API（TS7 支持尚未落地，
 * 见 typescript-eslint#10940），因此 workspace 的 `typescript` 别名装的是
 * @typescript/typescript6；真正的类型检查通过 @typescript/native 的
 * TS7 二进制执行（见根 package.json 的 ts7 / typecheck 脚本）。
 *
 * 本配置不做类型感知（不接 project service），保持轻量、稳定。
 */
export default [
	{
		name: "koishi-ce/vue",
		// 只圈定所有含 .vue 的 client / app 目录；.ts 一律归 biome 管
		files: [
			"apps/online/app/**/*.vue",
			"packages/web/*/src/**/*.vue",
			"plugins/webui/*/client/**/*.vue",
		],
		languageOptions: {
			// 模板用 vue-eslint-parser，<script> 块内部再交给 @typescript-eslint/parser
			parser: vueParser,
			parserOptions: {
				parser: tsParser,
				ecmaVersion: "latest",
				sourceType: "module",
			},
		},
		plugins: {
			vue: pluginVue,
			"koishi-ce-vue": templateCastPlugin,
		},
		rules: {
			// ── 组件引用 / 未定义（根治大小写坑）──
			// ^K：@koishi-ce/components 全局元素；^el-：宿主 console 注册的 element-plus；
			// ^router-：宿主提供的 vue-router 全局组件
			"vue/no-undef-components": [
				"error",
				{ ignorePatterns: ["^K", "^el-", "^router-"] },
			],
			"vue/no-unused-components": "error",

			// ── 模板指令合法性 ──
			"vue/valid-template-root": "error",
			"vue/valid-v-bind": "error",
			"vue/valid-v-cloak": "error",
			"vue/valid-v-else": "error",
			"vue/valid-v-else-if": "error",
			"vue/valid-v-for": "error",
			"vue/valid-v-html": "error",
			"vue/valid-v-if": "error",
			"vue/valid-v-model": "error",
			"vue/valid-v-on": "error",
			"vue/valid-v-once": "error",
			"vue/valid-v-pre": "error",
			"vue/valid-v-show": "error",
			"vue/valid-v-slot": "error",
			"vue/valid-v-text": "error",

			// ── 编译宏正确性 ──
			"vue/valid-define-props": "error",
			"vue/valid-define-emits": "error",
			"vue/valid-define-options": "error",

			// ── 常见坑 ──
			"vue/no-mutating-props": "error",
			"vue/no-async-in-computed-properties": "error",
			"vue/no-side-effects-in-computed-properties": "error",
			"vue/no-ref-as-operand": "error",
			"vue/no-use-v-if-with-v-for": "error",
			"vue/require-v-for-key": "error",
			"vue/no-dupe-keys": "error",
			"vue/no-export-in-script-setup": "error",

			// ── 模板表达式类型断言纪律（文本级内联规则，机理见上方插件注释）──
			"koishi-ce-vue/template-no-cast": "error",
		},
	},
] satisfies Linter.Config[];
