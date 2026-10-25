// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 全局组件 / 指令的类型声明：components 安装函数在运行时注册的全局件
 * （<k-*> 家族、<virtual-list> 与 v-loading 指令）的类型载体，经 vue 模块的
 * GlobalComponents / GlobalDirectives 增强合并生效。
 *
 * - 消费方：vue-tsc 影子闸门（TS 5.9）与 TS 7.1 content mapper
 *   （tsc --runExternalCode）在检查 .vue 模板时解析出真实组件类型；
 *   大一统 tsc 程序（无 mapper、.vue 不入程序）下 .vue 导入回落到
 *   client/global.d.ts 的不透明 Component 通配，本文件对其零扰动。
 * - IDE 单工程 / 下游消费经 client/global.d.ts 的 /// reference 引入本文件
 *   （沿 icons/virtual.d.ts 的挂载范式）。
 * - k-form / k-schema 系 schemastery-vue 插件运行时注册（该包仅以 TS 源码
 *   发布，实体无法类型导入），按 shims.d.ts 的宽松镜像纪律声明为 Component。
 */
import type { Component } from "vue";

declare module "vue" {
	export interface GlobalComponents {
		// common 基础原子件
		"k-button": typeof import("./common/button.vue")["default"];
		"k-hint": typeof import("./common/hint.vue")["default"];
		"k-tab": typeof import("./common/tab.vue")["default"];
		"k-activity-link": typeof import("./common/link").KActivityLink;
		// layout 容器与排版
		"k-card": typeof import("./layout/card.vue")["default"];
		"k-content": typeof import("./layout/content.vue")["default"];
		"k-empty": typeof import("./layout/empty.vue")["default"];
		"k-tab-group": typeof import("./layout/tab-group.vue")["default"];
		"k-tab-item": typeof import("./layout/tab-item.vue")["default"];
		// core 插槽
		"k-slot": typeof import("./core/slot").KSlot;
		"k-slot-item": typeof import("./core/slot").KSlotItem;
		"k-layout": ReturnType<
			typeof import("./core/slot").defineSlotComponent
		>;
		"k-status": ReturnType<
			typeof import("./core/slot").defineSlotComponent
		>;
		// form 与 icons
		"k-filter": typeof import("./form/filter.vue")["default"];
		"k-icon": typeof import("./icons").KIcon;
		// display 展示
		"k-comment": typeof import("./display/comment.vue")["default"];
		"k-image-viewer": typeof import("./display/image-viewer/viewer.vue")["default"];
		"k-markdown": typeof import("./display/markdown.ts")["default"];
		// virtual 虚拟列表
		"virtual-list": typeof import("./virtual").VirtualList;
		// schemastery-vue 插件注册的全局件（宽松镜像，见文件头）
		"k-form": Component;
		"k-schema": Component;
	}
	export interface GlobalDirectives {
		// element-plus 的 global.d.ts 只声明 ElXxx 组件家族，指令无声明
		// （2.14.x 实测），此处按主入口导出补齐
		vLoading: typeof import("element-plus")["vLoading"];
	}
}
