// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/components 共享组件库入口（Vue 插件形态）——全仓唯一的
 * UI 组件库。汇总并装配：
 *
 * - element-plus（全量安装与全局样式）；
 * - 表单（schemastery-vue 的 k-schema 体系 + k-filter 过滤器）；
 * - 虚拟列表（virtual-list）；
 * - 基础组件（k-button / k-hint / k-tab）与布局（k-card / k-content /
 *   k-empty / k-tab-group / k-tab-item）；
 * - 插槽（k-slot）与页面链接（k-activity-link）；
 * - 图标中心（k-icon 与全部内置图标）；
 * - Markdown 渲染（k-markdown）与聊天图片查看（chat 子模块）；
 * - 通用展示件（k-comment 通知条、k-image-viewer 图片查看器）；
 * - 两个依赖宿主数据仓库的 schema 控件扩展（any+dynamic 动态表单、
 *   array+perms 权限选择器），与 form 的扩展注册同构。
 *
 * 宿主 `@koishi-ce/client` 以 `export *` 二次转出本包全部公共 API
 * （历史兼容面：控制台插件统一从 client 导入）。
 */
import Element, {
	ElLoading,
	ElMessage,
	ElMessageBox,
} from "element-plus";
import type { App } from "vue";
import ChatImage from "./chat/image.vue";
import common from "./common";
import Dynamic from "./dynamic.vue";
import form, { SchemaBase } from "./form";
import * as icons from "./icons";
import ImageViewer from "./image-viewer.vue";
import { useStore } from "./injection";
import Comment from "./k-comment.vue";
import layout from "./layout";
import link from "./link";
import Markdown from "./markdown.ts";
import Perms from "./perms.vue";
import slot from "./slot";
import virtual from "./virtual";

// 组件库的全局样式（含 element-plus 覆盖等）
import "./index.scss";

/** 全局 loading 遮罩服务（ElLoading.service） */
export const loading = ElLoading.service;
/** 全局消息提示（ElMessage） */
export const message = ElMessage;
/** 全局对话框（ElMessageBox） */
export const messageBox = ElMessageBox;

export { default as Overlay } from "./chat/overlay.vue";
export * from "./common";
export * from "./form";
export * as icons from "./icons";
export * from "./injection";
export * from "./layout";
export * from "./link";
export * from "./slot";
export * from "./virtual";
export { ChatImage, Markdown };

// cosmokit 的名字刻意不在本入口直接 re-export：./form 透传的 schemastery-vue
// 源码自身就有 `export * from 'cosmokit'`，dev transform 管线（非打包、
// 逐文件服务）下两条 star 链会以不同的模块 URL 各自透出同名，被 Vite 判为
// conflicting star exports，浏览器端控制台整体加载失败（上游有这行是因为
// 其组件库以打包产物发布，dev 下不经过浏览器原生解析 star 导出）。省略后
// cosmokit 的导出面仍经 form 链完整透出，包的公共 API 不变。

// schema 控件扩展：dynamic 角色——实际 schema 由服务端按 meta.extra.name 下发，
// 组件内再经 useStore() 读取 store.schema "水合"（见 dynamic.vue）
SchemaBase.extensions.add({
	type: "any",
	role: "dynamic",
	component: Dynamic,
});

// schema 控件扩展：perms 角色——权限路径多级选择器（见 perms.vue），
// 权限数据（store.permissions）未就绪时校验不过
SchemaBase.extensions.add({
	type: "array",
	role: "perms",
	component: Perms,
	validate: () => !!useStore().permissions,
});

/**
 * Vue 插件安装函数：装配 element-plus 并注册全部全局组件。
 * @param app 宿主的 Vue 应用实例
 */
export default function (app: App) {
	app.use(Element);
	app.use(form);
	app.use(virtual);
	app.use(common);
	app.use(icons);
	app.use(layout);
	app.use(link);
	app.use(slot);
	app.component("k-comment", Comment);
	app.component("k-image-viewer", ImageViewer);
	app.component("k-markdown", Markdown);
}
