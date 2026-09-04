// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置组件库的总装模块：
 *
 * - 汇入 element-plus、markdown 渲染、公共/布局/图标/插槽等组件并统一注册；
 * - 转出 element-plus 的 loading / message / messageBox 服务供全局调用；
 * - 向 schemastery-vue 注册两个 schema 控件扩展：
 *   any+dynamic（由服务端下发 schema 的动态表单，见 dynamic.vue）
 *   与 array+perms（权限多级选择器，见 perms.vue）。
 */
// "@koishi-ce/components" 的 exports 仅有 "source" 条件,浏览器侧 tsconfig
// 无法解析(无 paths),故直接相对导入工作区内该包的浏览器端入口,
// 与构建器 collectWorkspaceAliases 的映射目标一致

import Element, {
	ElLoading,
	ElMessage,
	ElMessageBox,
} from "element-plus";
import Markdown from "marked-vue";
import type { App } from "vue";
import components, {
	SchemaBase,
} from "../../../components/client/index.ts";

import { store } from "../data";
import ChatImage from "./chat/image.vue";
import common from "./common";
import Dynamic from "./dynamic.vue";
import * as icons from "./icons";
import layout from "./layout";
import link from "./link";
import Perms from "./perms.vue";
import slot from "./slot";

import "element-plus/dist/index.css";

/** 全局 loading 遮罩服务（ElLoading.service） */
export const loading = ElLoading.service;
/** 全局消息提示（ElMessage） */
export const message = ElMessage;
/** 全局对话框（ElMessageBox） */
export const messageBox = ElMessageBox;

export * from "vue-i18n";
export * from "../../../components/client/index.ts";
export * from "./common";
export * from "./layout";
export * from "./link";
export * from "./slot";

export { ChatImage, icons };

// schema 控件扩展：dynamic 角色——实际 schema 由服务端按 meta.extra.name 下发，
// 组件内再经 store.schema "水合"（见 dynamic.vue）
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
	validate: () => !!store.permissions,
});

/** Vue app 安装入口：注册全局组件与 markdown 组件 */
export default function (app: App) {
	app.use(Element);
	app.component("k-markdown", Markdown);

	app.use(common);
	app.use(components);
	app.use(icons);
	app.use(layout);
	app.use(link);
	app.use(slot);
}
