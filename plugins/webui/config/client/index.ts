// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * config 插件的浏览器端入口。
 *
 * 以 `configWriter` 服务的形式向其它控制台插件（如 market、sms）提供
 * "定位 / 添加 / 移除插件配置"的编程接口（ensure / remove / get），
 * 同时负责装配本插件的 UI：
 * - 注册 plugin-select 插槽与全局弹层（forks 管理器）；
 * - 注册 /plugins 路由的"插件配置"页面（components/index.vue）；
 * - 声明配置树右键菜单 config.tree 的菜单项与图标。
 */
import {
	type Context,
	router,
	Service,
	send,
} from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-config";
import { defineComponent, h, resolveComponent } from "vue";
import Forks from "./components/forks.vue";
import Settings from "./components/index.vue";
import Select from "./components/select.vue";
import {
	dialogFork,
	plugins,
	type,
} from "./components/utils";
import deDE from "./locales/de-DE.yml";
import enUS from "./locales/en-US.yml";
import frFR from "./locales/fr-FR.yml";
import jaJP from "./locales/ja-JP.yml";
import ruRU from "./locales/ru-RU.yml";
import zhCN from "./locales/zh-CN.yml";
import zhTW from "./locales/zh-TW.yml";

import "virtual:uno.css";
import "./index.scss";
import "./icons";

export * from "./components/utils";

declare module "@koishi-ce/client" {
	interface Context {
		configWriter: ConfigWriter;
	}
}

/** 浏览器端的配置写入器：包装 manager/* 事件，供其它插件调用。 */
export default class ConfigWriter extends Service {
	constructor(ctx: Context) {
		super(ctx, "configWriter", true);

		// 注入本扩展的 UI 语言包（各语种键均收纳在 config.* 命名空间下）
		ctx.$i18n.extend("de-DE", deDE);
		ctx.$i18n.extend("en-US", enUS);
		ctx.$i18n.extend("fr-FR", frFR);
		ctx.$i18n.extend("ja-JP", jaJP);
		ctx.$i18n.extend("ru-RU", ruRU);
		ctx.$i18n.extend("zh-CN", zhCN);
		ctx.$i18n.extend("zh-TW", zhTW);

		// 全局插槽 plugin-select:默认渲染插件选择弹窗,允许其它插件填充内容
		ctx.slot({
			type: "global",
			component: defineComponent(() => () => {
				return h(resolveComponent("k-slot"), {
					name: "plugin-select",
					single: true,
				});
			}),
		});

		// 选择弹窗的两个挂载位:base 位用于自定义场景,普通位用于默认场景
		ctx.slot({
			type: "plugin-select-base",
			component: Select,
			order: -1000,
		});

		ctx.slot({
			type: "plugin-select",
			component: Select,
			order: -1000,
		});

		// fork 管理弹窗(管理同一插件的多份配置)挂到全局插槽
		ctx.slot({
			type: "global",
			component: Forks,
		});

		// 插件配置页面:路由 /plugins/:name*,name 为分组路径标识
		ctx.page({
			id: "config",
			path: "/plugins/:name*",
			name: () => ctx.$i18n.t("config.title"),
			icon: "activity:plugin",
			order: 800,
			authority: 4,
			fields: ["config", "packages", "services"],
			component: Settings,
		});

		// 配置树右键菜单:各项的 type/icon/label 支持按当前选中节点动态计算
		ctx.menu("config.tree", [
			{
				id: "config.tree.toggle",
				type: ({ config }) =>
					config.tree?.disabled ? "" : (type.value ?? ""),
				icon: ({ config }) =>
					config.tree?.disabled ? "play" : "stop",
				label: ({ config }) =>
					ctx.$i18n.t(
						config.tree?.disabled
							? config.tree?.name === "group"
								? "config.menu.enableGroup"
								: "config.menu.enablePlugin"
							: config.tree?.name === "group"
								? "config.menu.disableGroup"
								: "config.menu.disablePlugin",
					),
			},
			{
				id: ".save",
				icon: ({ config }) =>
					config.tree?.disabled ? "save" : "check",
				label: ({ config }) =>
					ctx.$i18n.t(
						config.tree?.disabled
							? "config.menu.saveConfig"
							: "config.menu.reloadConfig",
					),
			},
			{
				id: "@separator",
			},
			{
				id: ".rename",
				icon: "edit",
				label: () => ctx.$i18n.t("config.menu.rename"),
			},
			{
				id: ".remove",
				type: "danger",
				icon: "delete",
				label: ({ config }) =>
					ctx.$i18n.t(
						config.tree?.children
							? "config.menu.removeGroup"
							: "config.menu.removePlugin",
					),
			},
			{
				id: "@separator",
			},
			{
				id: ".clone",
				icon: "clone",
				label: () => ctx.$i18n.t("config.menu.clone"),
			},
			{
				id: ".manage",
				icon: "manage",
				label: () => ctx.$i18n.t("config.menu.manage"),
			},
			{
				id: ".add-plugin",
				icon: "add-plugin",
				label: () => ctx.$i18n.t("config.menu.addPlugin"),
			},
			{
				id: ".add-group",
				icon: "add-group",
				label: () => ctx.$i18n.t("config.menu.addGroup"),
			},
		]);
	}

	/**
	 * 打开（或创建后打开）某个插件的配置页。
	 *
	 * 根据该插件现有的 fork（配置份数）决定行为：无配置则新建一份停用
	 * 配置并跳转；恰好一份直接跳转；多份弹出 fork 管理弹窗让用户选择。
	 *
	 * @param name 插件完整包名（自动归一化为短名）
	 * @param passive 为 true 时只确保配置存在，不发生路由跳转 / 弹窗
	 */
	ensure(name: string, passive?: boolean) {
		const shortname = name.replace(
			/(koishi-|^@koishijs\/)plugin-/,
			"",
		);
		const forks = plugins.value.forks[shortname];
		if (!forks?.length) {
			const key = Math.random().toString(36).slice(2, 8);
			void send(
				"manager/unload",
				"",
				`${shortname}:${key}`,
				{},
			);
			if (!passive) router.push(`/plugins/${key}`);
		} else if (forks.length === 1) {
			if (!passive) router.push(`/plugins/${forks[0]}`);
		} else {
			if (!passive) dialogFork.value = name;
		}
	}

	/**
	 * 移除某个插件的全部配置（遍历所有 fork 逐个发送移除事件）。
	 *
	 * @param name 插件完整包名
	 */
	remove(name: string) {
		const shortname = name.replace(
			/(koishi-|^@koishijs\/)plugin-/,
			"",
		);
		const forks = plugins.value.forks[shortname];
		for (const id of forks ?? []) {
			const tree = plugins.value.paths[id];
			if (!tree) continue;
			void send(
				"manager/remove",
				tree.parent?.path ?? "",
				tree.id,
			);
		}
	}

	/**
	 * 查询某个插件的全部配置节点。
	 *
	 * @param name 插件完整包名
	 * @returns 对应的配置树节点列表（无配置时为 undefined）
	 */
	get(name: string) {
		const shortname = name.replace(
			/(koishi-|^@koishijs\/)plugin-/,
			"",
		);
		return plugins.value.forks[shortname]?.map(
			(id) => plugins.value.paths[id],
		);
	}
}
