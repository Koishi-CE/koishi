// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * notifier 插件（node 侧）：控制台通知中心。
 *
 * 提供两种通知形态：
 * - 常驻通知（Notifier）：显示在控制台插件详情页的提示条，
 *   由插件在运行期通过 ctx.notifier.create() 创建并随时 update 更新；
 * - 即时消息（message()）：向所有已连接的控制台广播一条消息条通知。
 *
 * 通知内容以 Koishi 元素（h.Fragment）描述，其中 button 的 onClick
 * 回调无法跨进程序列化，故登记到 actions 表、以随机 key 传给浏览器，
 * 浏览器点击时经 notifier/button 事件回调。
 */

import { resolve } from "node:path";
import {
	type Context,
	type Dict,
	h,
	isNullable,
	remove,
	Schema,
	Service,
} from "@koishi-ce/koishi";
import type { Entry } from "@koishi-ce/plugin-console";

declare module "@koishi-ce/koishi" {
	interface Context {
		notifier: NotifierService;
	}
}

declare module "@koishi-ce/console" {
	interface Events {
		"notifier/button"(id: string): void;
	}
}

/**
 * 单条常驻通知：创建即注册到 NotifierService.store 并触发控制台刷新，
 * dispose 时从 store 移除。内容支持字符串或元素片段，可含 button / progress。
 */
export class Notifier {
	public ctx: Context;
	public options: Notifier.Config;
	public dispose: () => void;

	private actionKeys: string[] = [];

	// constructor 参数属性被 erasableSyntaxOnly 禁止，拆为显式字段赋值
	constructor(
		ctx: Context,
		options: h.Fragment | Notifier.Options,
	) {
		this.ctx = ctx;
		this.options = {
			type: "primary",
			content: [],
		};
		ctx.notifier.store.push(this);
		this.update(options);
		ctx.notifier.entry?.refresh();
		this.dispose = ctx.collect("entry", () => {
			this.clearActions();
			remove(ctx.notifier.store, this);
			ctx.notifier.entry?.refresh();
		});
	}

	/** 清空本通知登记的所有按钮回调（更新内容或销毁前调用）。 */
	clearActions() {
		for (const key of this.actionKeys) {
			delete this.ctx.notifier.actions[key];
		}
		this.actionKeys = [];
	}

	/**
	 * 更新通知内容。
	 *
	 * 入参为纯文本 / 元素 / 数组时视作 content 的简写；content 变化时
	 * 将 button 元素的 onClick 函数摘出登记到服务端 actions 表、attrs 中
	 * 改存随机 key，其余元素原样保留，最后整体合并进 options 并刷新控制台。
	 */
	update(options: h.Fragment | Notifier.Options) {
		if (
			typeof options === "string" ||
			h.isElement(options) ||
			Array.isArray(options)
		) {
			options = { content: options };
		}
		if (!isNullable(options?.content)) {
			this.clearActions();
			const content =
				typeof options.content === "string"
					? [h("p", options.content)]
					: h.toElementArray(options.content);
			options.content = h.transform(
				content,
				({ type, attrs }) => {
					if (
						type === "button" &&
						typeof attrs["onClick"] === "function"
					) {
						const key = Math.random().toString(36).slice(2);
						this.ctx.notifier.actions[key] =
							attrs["onClick"];
						this.actionKeys.push(key);
						attrs["onClick"] = key;
					}
					return true;
				},
			);
		}
		Object.assign(this.options, options);
		this.ctx.notifier.entry?.refresh();
	}

	/** 序列化为浏览器端可渲染的数据：content 拼接为字符串，附带 loader 路径用于归属插件。 */
	toJSON(): Notifier.Data {
		const paths = this.ctx
			.get("loader")
			?.paths(this.ctx.scope);
		return {
			...this.options,
			content: this.options.content.join(""),
			...(paths !== undefined ? { paths } : {}),
		};
	}
}

export namespace Notifier {
	/** 通知级别（对应控制台提示条配色）。 */
	export type Type =
		| "primary"
		| "success"
		| "warning"
		| "danger";

	/** 用户侧传入的选项：content 允许任意元素片段。 */
	export interface Options<T = h.Fragment> {
		type?: Type;
		content?: T;
	}

	/** 内部规范化后的选项（content 已拆为元素数组、type 已定默认值）。 */
	export interface Config extends Required<Options> {
		content: h[];
	}

	/** 推送给浏览器的序列化形态。 */
	export interface Data extends Required<Options> {
		content: string;
		paths?: string[];
	}
}

/**
 * 通知中心服务：维护全部常驻通知（store）与按钮回调表（actions），
 * 并在 console 可用时注册控制台页面入口与按钮点击监听。
 */
class NotifierService extends Service {
	static inject = { optional: ["notifier"] };

	// 配置 schema 的值侧由类静态承载（erasableSyntaxOnly 不允许 namespace 内运行时值），
	// 类型侧见下方 namespace NotifierService 的 Config
	static Config: Schema<NotifierService.Config> =
		Schema.object({});

	public store: Notifier[] = [];
	public actions: Dict<() => void> = Object.create(null);
	// 显式联合以兼容 exactOptionalPropertyTypes 下置 undefined 的写法
	public entry: Entry<NotifierService.Data> | undefined;

	public override config: NotifierService.Config;

	// constructor 参数属性被 erasableSyntaxOnly 禁止，拆为显式字段赋值
	constructor(
		ctx: Context,
		config: NotifierService.Config,
	) {
		super(ctx, "notifier", true);
		this.config = config;

		ctx.inject(["console"], (ctx) => {
			ctx.on("dispose", () => (this.entry = undefined));

			this.entry = ctx.console.addEntry(
				process.env["KOISHI_BASE"]
					? [
							`${process.env["KOISHI_BASE"]}/dist/index.js`,
							`${process.env["KOISHI_BASE"]}/dist/style.css`,
						]
					: process.env["KOISHI_ENV"] === "browser"
						? [
								import.meta.url.replace(
									/\/src\/[^/]+$/,
									"/client/index.ts",
								),
							]
						: {
								dev: resolve(
									__dirname,
									"../client/index.ts",
								),
								prod: resolve(__dirname, "../dist"),
							},
				() => ({
					notifiers: this.store.map((notifier) =>
						notifier.toJSON(),
					),
				}),
			);

			ctx.console.addListener(
				"notifier/button",
				(id: string) => {
					return this.actions[id]?.();
				},
			);
		});
	}

	/**
	 * 广播一条即时消息通知（对应浏览器端弹出的消息条）。
	 *
	 * @param options 文本或选项对象；type 缺省为 primary
	 */
	message(options?: string | Notifier.Options<string>) {
		// 显式兜底 undefined，避免对可空入参解引用
		const data: Notifier.Options<string> =
			typeof options === "string"
				? { content: options }
				: (options ?? {});
		data.type ||= "primary";
		this.ctx
			.get("console")
			?.broadcast("notifier/message", data);
	}

	/** 创建一条常驻通知（options 缺省时为空内容通知）。 */
	create(options?: h.Fragment | Notifier.Options) {
		return new Notifier(this.ctx, options ?? {});
	}
}

namespace NotifierService {
	/** 控制台入口的 RPC 数据形态：全部常驻通知的序列化列表。 */
	export interface Data {
		notifiers: Notifier.Data[];
	}

	/** 插件配置类型（当前无可用配置项）。 */
	export type Config = Record<never, never>;
}

export default NotifierService;
