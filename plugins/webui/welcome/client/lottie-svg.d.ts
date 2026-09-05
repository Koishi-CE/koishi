// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * lottie-web 仅根入口带类型声明（index.d.ts），SVG-only 精简构建
 * （build/player/esm/lottie_svg.min.js）的深路径导入无类型，
 * 此处桥接到根入口的类型（导出形状完全一致）。
 */
declare module "lottie-web/build/player/esm/lottie_svg.min.js" {
	export * from "lottie-web";
	export { default } from "lottie-web";
}
