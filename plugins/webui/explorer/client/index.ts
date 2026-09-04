// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * explorer 插件（浏览器端入口）：注册文件管理器页面与配套 UI。
 *
 * - /files 路由的主页面（index.vue：左侧文件树 + 右侧 monaco 编辑器）
 * - Schema path 角色的路径选择控件（file-picker.vue，供其它插件的配置表单使用）
 * - 全局上传对话框（upload.vue）与状态栏当前语言指示（status.vue）
 * - explorer / explorer.tree 两组菜单项，供页面动作与文件树右键菜单挂载
 */

import type { Context } from "@koishi-ce/client";
import type { Entry } from "@koishi-ce/plugin-explorer";
import FilePicker from "./file-picker.vue";
import Layout from "./index.vue";
import deDE from "./locales/de-DE.yml";
import enUS from "./locales/en-US.yml";
import frFR from "./locales/fr-FR.yml";
import jaJP from "./locales/ja-JP.yml";
import ruRU from "./locales/ru-RU.yml";
import zhCN from "./locales/zh-CN.yml";
import zhTW from "./locales/zh-TW.yml";
import Status from "./status.vue";
import Upload from "./upload.vue";
import "./icons";
import "./editor";

import "virtual:uno.css";
import "./editor.scss";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 explorer 键,使 ctx.page 的 fields 通过检查
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			explorer: DataService<Entry[]>;
		}
	}
}

export default (ctx: Context) => {
	// 注入本扩展的 UI 语言包（各语种键均收纳在 explorer.* 命名空间下）
	ctx.$i18n.extend("de-DE", deDE);
	ctx.$i18n.extend("en-US", enUS);
	ctx.$i18n.extend("fr-FR", frFR);
	ctx.$i18n.extend("ja-JP", jaJP);
	ctx.$i18n.extend("ru-RU", ruRU);
	ctx.$i18n.extend("zh-CN", zhCN);
	ctx.$i18n.extend("zh-TW", zhTW);

	// 注册 path 角色的 string 控件:配置表单中的路径字段
	// 会渲染为 FilePicker 弹窗选择器
	ctx.schema({
		type: "string",
		role: "path",
		component: FilePicker,
		validate: (value) => typeof value === "string",
	});

	// 全局插槽:挂载拖拽/粘贴上传的监听对话框
	ctx.slot({
		type: "global",
		component: Upload,
	});

	// 文件管理器主页面(左侧树 + 右侧编辑器),依赖 explorer 数据服务
	ctx.page({
		id: "files",
		path: "/files/:name*",
		// name / label 传 getter：渲染层解析，随界面语言切换
		name: () => ctx.$i18n.t("explorer.title"),
		icon: "activity:explorer",
		order: 600,
		fields: ["explorer"],
		component: Layout,
	});

	// 状态栏右侧:当前编辑文件的语言名
	ctx.slot({
		type: "status-right",
		component: Status,
	});

	// 页面级菜单(ctrl+s / ctrl+r),由 index.vue 的 ctx.action 响应
	ctx.menu("explorer", [
		{
			id: "explorer.save",
			icon: "save",
			label: () => ctx.$i18n.t("explorer.menu.save"),
		},
		{
			id: "explorer.refresh",
			icon: "refresh",
			label: () => ctx.$i18n.t("explorer.menu.refresh"),
		},
	]);

	// 文件树右键菜单(id 以 . 开头的项挂在节点上,由 explorer.tree 上下文触发)
	ctx.menu("explorer.tree", [
		{
			id: ".create-file",
			icon: "file-create",
			label: () => ctx.$i18n.t("explorer.menu.createFile"),
		},
		{
			id: ".create-directory",
			icon: "directory-create",
			label: () =>
				ctx.$i18n.t("explorer.menu.createDirectory"),
		},
		{
			id: ".upload",
			icon: "upload",
			label: () => ctx.$i18n.t("explorer.menu.upload"),
		},
		{
			id: ".download",
			icon: "download",
			label: () => ctx.$i18n.t("explorer.menu.download"),
		},
		{
			id: "@separator",
		},
		{
			id: ".rename",
			icon: "edit",
			label: () => ctx.$i18n.t("explorer.menu.rename"),
		},
		{
			id: ".remove",
			icon: "delete",
			type: "danger",
			label: () => ctx.$i18n.t("explorer.menu.remove"),
		},
	]);
};
