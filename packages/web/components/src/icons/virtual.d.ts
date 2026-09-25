// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * ~icons 虚拟模块的类型载体：真实模块由 unplugin-icons 在编译期生成
 * （console-builder 的 icons.ts），源码内不存在对应文件。这里把形态声明
 * 为接受 svg 属性透传的函数组件；集合 k 与子路径仅是命名约定，类型层
 * 不做逐图标收窄，与注册表按字符串名渲染的既有契约一致。
 */
declare module "~icons/*" {
	import type {
		FunctionalComponent,
		SVGAttributes,
	} from "vue";

	const icon: FunctionalComponent<SVGAttributes>;
	export default icon;
}
