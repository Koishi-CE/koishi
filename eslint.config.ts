// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import tsParser from "@typescript-eslint/parser";
import type { Linter } from "eslint";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";

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
			"packages/web/*/client/**/*.vue",
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
		plugins: { vue: pluginVue },
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
		},
	},
] satisfies Linter.Config[];
