// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 插件产物 JS 的裸导入改写（原 node/index.ts 拆出的纯函数）。
 *
 * 把产物中的裸包名导入指向宿主控制台自带的共享模块
 * （vue.js / client.js 等），避免每个插件产物各打包一份运行时。
 */

/**
 * 插件产物 JS 中的裸包名到宿主控制台共享模块的改写映射。
 * `@koishijs/client` 与 `@koishi-ce/client` 同源，供市场安装的上游官方
 * webui 插件（其产物裸导入上游包名）复用同一份共享 chunk。
 */
export const SHARED_IMPORT_MAP: Record<string, string> = {
	vue: "../vue.js",
	"vue-router": "../vue-router.js",
	"@vueuse/core": "../vueuse.js",
	"@koishi-ce/client": "../client.js",
	"@koishijs/client": "../client.js",
};

/**
 * 把插件产物 JS 中的裸导入改写为宿主共享模块的相对路径。
 * 产物由 vite/rolldown 压缩生成，导入语句的形态不止 `import … from`
 * 一种，以下形态都必须覆盖，否则浏览器端会以裸名直接加载而失败：
 * - `import { x } from "vue"` / `import x from "vue"`（含压缩后无空格形态）
 * - `import "vue"`（无绑定名的副作用导入，如插件只注册路由）
 * - `export { x } from "vue"` / `export * from "vue"`（再导出）
 * - `import("vue")`（动态导入）
 * 映射之外的说明符（相对路径、其他依赖）原样保留。
 */
export function rewriteSharedImports(source: string) {
	// 前导边界：import/export 关键字前必须是语句边界字符（行首、;、}、
	// 空白、括号等），不能紧跟引号或标识符字符——否则字符串字面量里
	// 恰好出现的 "import … from 'vue'" 文案也会被误改写
	const boundary = String.raw`(?:^|[^\w.'"])`;
	const rewrite = (
		stmt: string,
		left: string,
		quote: string,
		spec: string,
		right = "",
	) => {
		const target = SHARED_IMPORT_MAP[spec];
		return target === undefined
			? stmt
			: left + quote + target + quote + right;
	};
	return source
		.replace(
			new RegExp(
				`(${boundary}(?:\\bimport|\\bexport)\\b[^;'"]*?\\bfrom\\s*)(["'])([^"']+)\\2`,
				"g",
			),
			(stmt, left: string, quote: string, spec: string) =>
				rewrite(stmt, left, quote, spec),
		)
		.replace(
			new RegExp(
				`(${boundary}\\bimport\\s*)(["'])([^"']+)\\2(?=\\s*[;\\n])`,
				"g",
			),
			(stmt, left: string, quote: string, spec: string) =>
				rewrite(stmt, left, quote, spec),
		)
		.replace(
			new RegExp(
				`(${boundary}\\bimport\\(\\s*)(["'])([^"']+)\\2(\\s*\\))`,
				"g",
			),
			(
				stmt,
				left: string,
				quote: string,
				spec: string,
				right: string,
			) => rewrite(stmt, left, quote, spec, right),
		);
}
