// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * ~icons 虚拟模块的类型载体：真实模块由 unplugin-icons 在编译期生成
 * （console-builder 的 icons.ts），源码内不存在对应文件。这里把形态声明
 * 为接受 svg 属性透传的函数组件；集合 k 与子路径仅是命名约定，类型层
 * 不做逐图标收窄，与注册表按字符串名渲染的既有契约一致。
 *
 * 作用域接线：本文件的声明经两路进入类型程序——大一统 tsconfig.web.json
 * 的 include（components/src）覆盖 CLI 门禁；各 client 子工程由
 * packages/web/client/global.d.ts 的三斜线引用携带，随基座
 * tsconfig.client.json 的 files 下发（extends 的 files/include 各自独立
 * 继承），IDE 单工程解析因此全覆盖，无需逐工程引入。
 */
declare module "~icons/*" {
	import type {
		FunctionalComponent,
		SVGAttributes,
	} from "vue";

	const icon: FunctionalComponent<SVGAttributes>;
	export default icon;
}
