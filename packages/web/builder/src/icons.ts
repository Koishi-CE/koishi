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
 * 图标组件必须保持单根：多根 fragment 在 prod 运行时丢弃外部传入的
 * attribute，`<k-icon class="...">` 的 class 就落不到 svg 上，尺寸
 * 回落到组件内联的 `.k-icon { height: 1em }`。@iconify/utils 的
 * getCustomIcon 目前已把 `<svg` 之前的内容整体切掉，本函数是 loader
 * 层的兜底（不依赖该实现的版本行为），与编译期 NODE_ENV 无关。
 */
export function stripLeadingSvgComments(
	svg: string,
): string {
	return svg.replace(/^(?:\s|<!--[\s\S]*?-->)*/, "");
}

/**
 * 不向图标产物注入 width / height：写入 iconify 的「取消」关键字 unset。
 *
 * unplugin-icons 经 @iconify/utils 的 mergeIconProps 生成组件时，先调用
 * iconCustomizer，随后才由 configureSvgSize 按 scale（默认 1.2）补写
 * width / height；因此在这里 delete 是空操作（删的是尚未写入的键），产物
 * 仍带 width="1.2em" height="1.2em"。只有写入 iconify 的取消关键字
 * （isUnsetKeyword 识别 unset / undefined / none），configureSvgSize 才会
 * 真正丢弃这两项。
 *
 * 保留默认尺寸的实际后果：svg 视口被 width="1.2em" 锁在 16px 字号下的
 * 约 19px，而 CSS 只设 height（侧栏 .activity-button-icon 为 1.5rem），
 * preserveAspectRatio 按宽度贴边，方形与扁形图标撑不满高度——来自
 * assets/icons 的图标因此比无 width 属性的内联图标小一圈甚至一半。
 */
export function unsetIconSize(
	props: Record<string, string>,
) {
	props["width"] = "unset";
	props["height"] = "unset";
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
		// 尺寸完全交给 CSS（.k-icon 的 height）：产物若有固定宽高，非方形
		// 图标会被宽度锁死（机理见 unsetIconSize）
		iconCustomizer(_collection, _icon, props) {
			unsetIconSize(props);
		},
	});
}
