// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.
// upstream: koishijs/webui plugins/console/src/node/index.ts（static Dev/Head/Config Schema 段；上游为单文件 5.30.11 线，本仓拆分时抽离至本文件，同步时以其整体 diff 对照本目录）

/**
 * NodeConsole 的三个 Schema 常量（原 node/index.ts 类内 static 属性拆出）。
 *
 * erasableSyntaxOnly 禁止含运行时值的 namespace，Schema 常量在本模块
 * 求值，由 index.ts 类体以 `static Dev = DevSchema` 等三行赋值挂回
 * 类上（对象同一性不变，`NodeConsole.Dev / Head / Config` 取值不变）。
 */

import { Schema, Time } from "@koishi-ce/koishi";
import deDE from "../../locales/de-DE.yml";
import enUS from "../../locales/en-US.yml";
import frFR from "../../locales/fr-FR.yml";
import jaJP from "../../locales/ja-JP.yml";
import ruRU from "../../locales/ru-RU.yml";
import zhCN from "../../locales/zh-CN.yml";
import zhTW from "../../locales/zh-TW.yml";
import type NodeConsole from "./index.ts";

/** Vite 开发服务器配置 Schema：文件访问控制、域名放行与 HMR 端口（NodeConsole.Dev）。 */
export const DevSchema: Schema<NodeConsole.Dev> =
	Schema.object({
		fs: Schema.object({
			strict: Schema.boolean().default(true),
			// .default(null) 的空值占位超出 schemastery 类型定义，用精确断言放宽
			allow: Schema.array(String).default(null as never),
			deny: Schema.array(String).default(null as never),
		}).hidden(),
		allowedHosts: Schema.array(Schema.string())
			.default(null as never)
			.description(
				"允许访问开发服务器的额外域名，留空维持 Vite 默认（仅放行 localhost 与 IP 直连）。",
			),
		wsPort: Schema.number().description(
			"Vite 热更新 WebSocket 端口，留空用默认 24678（被占用时自动顺延），并行第二个开发实例时可显式指定。",
		),
	});

/** 注入 index.html 的自定义 head 标签 Schema（NodeConsole.Head）。 */
export const HeadSchema: Schema<NodeConsole.Head> =
	Schema.intersect([
		Schema.object({
			tag: Schema.union([
				"title",
				"link",
				"meta",
				"script",
				"style",
				Schema.string(),
			]).required(),
		}),
		Schema.union([
			Schema.object({
				tag: Schema.const("title").required(),
				content: Schema.string().role("textarea"),
			}),
			Schema.object({
				tag: Schema.const("link").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
			}),
			Schema.object({
				tag: Schema.const("meta").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
			}),
			Schema.object({
				tag: Schema.const("script").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
				content: Schema.string().role("textarea"),
			}),
			Schema.object({
				tag: Schema.const("style").required(),
				attrs: Schema.dict(Schema.string()).role("table"),
				content: Schema.string().role("textarea"),
			}),
			Schema.object({
				tag: Schema.string().required(),
				attrs: Schema.dict(Schema.string()).role("table"),
				content: Schema.string().role("textarea"),
			}),
		]),
	]);

/** NodeConsole 插件配置 Schema（NodeConsole.Config）。 */
export const ConfigSchema: Schema<NodeConsole.Config> =
	Schema.intersect([
		Schema.object({
			uiPath: Schema.string().default(""),
			apiPath: Schema.string().default("/status"),
			selfUrl: Schema.string().role("link").default(""),
			open: Schema.boolean(),
			head: Schema.array(HeadSchema),
			heartbeat: Schema.object({
				interval: Schema.number().default(Time.second * 30),
				timeout: Schema.number().default(Time.minute),
			}),
			devMode: Schema.boolean()
				.default(Bun.env["NODE_ENV"] === "development")
				.hidden(),
			cacheDir: Schema.string()
				.default("cache/vite")
				.hidden(),
			dev: DevSchema,
		}),
	]).i18n({
		"de-DE": deDE,
		"en-US": enUS,
		"fr-FR": frFR,
		"ja-JP": jaJP,
		"ru-RU": ruRU,
		"zh-CN": zhCN,
		"zh-TW": zhTW,
	});
