/// <reference types="vue-i18n" />
/// <reference types="vite/client" />
/// <reference types="element-plus/global" />

// 以下为消费本包（@koishi-ce/client/global）的插件工程提供的环境类型垫片：
// .vue 单文件组件与 yaml / yml 文案文件在此仅声明为无结构导出，
// 具体类型由各工程的构建工具链（vite 插件）在编译期处理

declare module "*.vue" {
	import { Component } from "vue";

	const component: Component;
	export default component;
}

declare module "*.yaml" {
	const content: {};
	export default content;
}

declare module "*.yml" {
	const content: {};
	export default content;
}
