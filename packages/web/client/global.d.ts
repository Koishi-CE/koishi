// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/// <reference types="vue-i18n" />
/// <reference types="vite/client" />
/// <reference types="element-plus/global" />
// ~icons 虚拟模块声明随本文件经基座 tsconfig.client.json 的 files 下发进所有
// client 子工程（extends 的 include 只替换 include，files 独立继承），IDE 单
// 工程解析因此全覆盖；声明本体在 components 的 virtual.d.ts，大一统门禁经
// components/src 的 include 另行覆盖
/// <reference path="../components/src/icons/virtual.d.ts" />

// 以下为消费本包（@koishi-ce/client/global）的插件工程提供的环境类型垫片：
// .vue 单文件组件与 yaml / yml 文案文件在此仅声明为无结构导出，
// 具体类型由各工程的构建工具链（vite 插件）在编译期处理

declare module "*.vue" {
	import { Component } from "vue";

	const component: Component;
	export default component;
}

declare module "*.yaml" {
	const content: Record<never, never>;
	export default content;
}

declare module "*.yml" {
	const content: Record<never, never>;
	export default content;
}
