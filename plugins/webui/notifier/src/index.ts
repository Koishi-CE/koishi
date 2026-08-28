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
import { resolve } from "path";

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

export class Notifier {
	public ctx: Context;
	public options: Notifier.Config;
	public dispose: () => void;

	private actionKeys: string[] = [];

	// constructor 参数属性被 erasableSyntaxOnly 禁止，拆为显式字段赋值
	constructor(ctx: Context, options: h.Fragment | Notifier.Options) {
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

	clearActions() {
		for (const key of this.actionKeys) {
			delete this.ctx.notifier.actions[key];
		}
		this.actionKeys = [];
	}

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
			options.content = h.transform(content, ({ type, attrs }) => {
				if (type === "button" && typeof attrs["onClick"] === "function") {
					const key = Math.random().toString(36).slice(2);
					this.ctx.notifier.actions[key] = attrs["onClick"];
					this.actionKeys.push(key);
					attrs["onClick"] = key;
				}
				return true;
			});
		}
		Object.assign(this.options, options);
		this.ctx.notifier.entry?.refresh();
	}

	toJSON(): Notifier.Data {
		const paths = this.ctx.get("loader")?.paths(this.ctx.scope);
		return {
			...this.options,
			content: this.options.content.join(""),
			...(paths !== undefined ? { paths } : {}),
		};
	}
}

export namespace Notifier {
	export type Type = "primary" | "success" | "warning" | "danger";

	export interface Options<T = h.Fragment> {
		type?: Type;
		content?: T;
	}

	export interface Config extends Required<Options> {
		content: h[];
	}

	export interface Data extends Required<Options> {
		content: string;
		paths?: string[];
	}
}

class NotifierService extends Service {
	static inject = { optional: ["notifier"] };

	// 配置 schema 的值侧由类静态承载（erasableSyntaxOnly 不允许 namespace 内运行时值），
	// 类型侧见下方 namespace NotifierService 的 Config
	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的 Config 静态属性
	static Config: Schema<NotifierService.Config> = Schema.object({});

	public store: Notifier[] = [];
	public actions: Dict<() => void> = Object.create(null);
	// 显式联合以兼容 exactOptionalPropertyTypes 下置 undefined 的写法
	public entry: Entry<NotifierService.Data> | undefined;

	public override config: NotifierService.Config;

	// constructor 参数属性被 erasableSyntaxOnly 禁止，拆为显式字段赋值
	constructor(ctx: Context, config: NotifierService.Config) {
		super(ctx, "notifier", true);
		this.config = config;

		ctx.inject(["console"], (ctx) => {
			ctx.on("dispose", () => (this.entry = undefined));

			this.entry = ctx.console.addEntry(
				process.env["KOISHI_BASE"]
					? [
							process.env["KOISHI_BASE"] + "/dist/index.js",
							process.env["KOISHI_BASE"] + "/dist/style.css",
						]
					: process.env["KOISHI_ENV"] === "browser"
						? [import.meta.url.replace(/\/src\/[^/]+$/, "/client/index.ts")]
						: {
								dev: resolve(__dirname, "../client/index.ts"),
								prod: resolve(__dirname, "../dist"),
							},
				() => ({
					notifiers: this.store.map((notifier) => notifier.toJSON()),
				}),
			);

			ctx.console.addListener("notifier/button", (id: string) => {
				return this.actions[id]?.();
			});
		});
	}

	message(options?: string | Notifier.Options<string>) {
		// 显式兜底 undefined，避免对可空入参解引用
		const data: Notifier.Options<string> =
			typeof options === "string" ? { content: options } : (options ?? {});
		data.type ||= "primary";
		this.ctx.get("console")?.broadcast("notifier/message", data);
	}

	create(options?: h.Fragment | Notifier.Options) {
		return new Notifier(this.ctx, options ?? {});
	}
}

namespace NotifierService {
	export interface Data {
		notifiers: Notifier.Data[];
	}

	export type Config = {};
}

export default NotifierService;
