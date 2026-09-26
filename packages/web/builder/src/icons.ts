// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 集中式图标资产的编译期转换插件（unplugin-icons 封装）。
 *
 * 图标以 .svg 文件集中存放于 @koishi-ce/components 包的 assets/icons/
 * 目录（注册体系与 <k-icon> 按名渲染仍在 components/src/icons/index.ts），
 * 源码经 `~icons/k/<相对路径>` 虚拟模块导入，由本插件在编译期转成 Vue
 * 组件。三处挂载点共用本工厂：插件前端构建（index.ts build）、宿主总装
 * （assemble.ts build）与 devMode dev server（index.ts createServer）。
 *
 * 资产目录按包名解析定位而非仓库相对路径：workspace 形态解析到源码包，
 * 下游 npm 形态解析到 node_modules 内的发布包（files 已携带 assets/），
 * 两端同一逻辑。
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * 剥除 svg 根元素之前的注释（许可头、版权头等）。
 *
 * 这些注释位于 <svg> 之前，unplugin-icons 的 vue3 编译器调
 * compileTemplate 时未透传 comments 选项，注释去留随构建进程的
 * NODE_ENV 漂移：development 环境下注释被保留进产物，图标组件被
 * 编译成「注释 + svg」的多根 fragment。Vue 运行时对这种 fragment 的
 * attribute 透传修复（getChildRoot，DEV_ROOT_FRAGMENT）仅在 dev
 * 运行时生效，prod 运行时外部传入的 class 落不到 svg 上，图标
 * 回落 .k-icon { height: 1em } 的 1em 尺寸（侧栏图标变小）。
 * 在 loader 层剥除后产物恒为单根，与编译模式无关。
 */
export function stripLeadingSvgComments(
	svg: string,
): string {
	return svg.replace(/^(?:\s|<!--[\s\S]*?-->)*/, "");
}

/** 创建图标编译插件；返回单个 vite 插件，调用方直接并入 plugins 数组 */
export async function iconsPlugin() {
	// components 的 exports 暴露 ./package.json，借此定位包根
	const manifestPath = createRequire(
		import.meta.url,
	).resolve("@koishi-ce/components/package.json");
	const dir = resolve(
		dirname(manifestPath),
		"assets/icons",
	);
	const Icons = (await import("unplugin-icons/vite"))
		.default;
	const { FileSystemIconLoader } = await import(
		"unplugin-icons/loaders"
	);
	return Icons({
		compiler: "vue3",
		customCollections: {
			// 集合名 k 是本仓集中图标资产的命名空间；transform 剥根元素
			// 前注释保证产物恒为单根（机理见 stripLeadingSvgComments）
			k: FileSystemIconLoader(dir, (svg) =>
				stripLeadingSvgComments(svg),
			),
		},
		// 现有尺寸行为依赖「svg 不带固定宽高 + .k-icon 样式的 height: 1em」
		// （非方形图标宽度按 viewBox 比例展开）；unplugin-icons 默认注入
		// width/height="1em" 会把非方形图标压成正方形留白，这里剥除
		iconCustomizer(_collection, _icon, props) {
			delete props["width"];
			delete props["height"];
		},
	});
}
