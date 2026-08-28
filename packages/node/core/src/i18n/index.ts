/**
 * 国际化（i18n）服务。
 *
 * 管理按语言（locale）与路径（如 `commands.help.messages.description`）
 * 组织的文案字典，提供：
 * - 文案的定义与撤销（define，随插件销毁自动回收）；
 * - 语言回退（fallback，基于 LocaleTree 计算候选语言序列）；
 * - 渲染（render，参数插值并解析为消息元素）；
 * - 模糊匹配（compare / find，Levenshtein 距离，用于指令纠错）。
 *
 * 同目录：locales.ts 内置语言定义、match.ts 模式匹配工具。
 * 权限系统的 `authority:(value)` 模板即复用 match.ts 的匹配机制。
 */
import { fallback, LocaleTree } from "@koishi-ce/i18n-utils";
import { h, Logger, Schema } from "@satorijs/core";
import { type Dict, isNullable } from "cosmokit";
import { distance } from "fastest-levenshtein";
import type { Context } from "../context";
import { defineBuiltInLocales } from "./locales";
import { type CompareOptions, findMatches, type MatchResult } from "./match";

export * from "./match";

const logger = new Logger("i18n");
/** Store 节点上的内部符号：指向预置渲染器名（_presets 的 key） */
const kTemplate = Symbol("template");

declare module "../context" {
	interface Context {
		/** i18n 服务实例 */
		i18n: I18n;
	}

	interface Events {
		/** 文案定义发生增删时触发（供控制台刷新文案列表） */
		"internal/i18n"(): void;
	}
}

export namespace I18n {
	/** 字典节点：叶子为字符串模板，非叶为子 Store；带 kTemplate 的对象走预置渲染器 */
	export type Node = string | Store;

	/** 层叠字典：深层对象展开为点分路径，kTemplate 指定自定义渲染器 */
	export interface Store {
		[kTemplate]?: string;
		[k: string]: Node;
	}

	/** 预置渲染器：把 (值, 插值参数, 语言) 渲染为字符串 */
	export type Formatter = (
		value: any,
		args: string[],
		locale: string,
	) => string;
	/** 渲染器签名（注册到 _presets 后由 kTemplate 引用） */
	export type Renderer = (dict: Dict, params: any, locale: string) => string;

	/** 查找选项（透传模糊匹配选项）。 */
	export interface FindOptions extends CompareOptions {}

	/** 模式查找结果：命中语言、捕获参数与相似度。 */
	export interface FindResult<P extends string> {
		locale: string;
		data: MatchResult<P>;
		similarity: number;
	}
}

/** i18n 服务：文案字典的注册表与渲染入口。 */
export class I18n {
	/** i18n 配置 Schema（可用语言列表 + 输出语言偏好） */
	static Config: Schema<I18n.Config> = Schema.object({
		locales: Schema.array(String)
			.role("table")
			.default(["zh-CN", "en-US", "fr-FR", "ja-JP", "de-DE", "ru-RU"])
			.description("可用的语言列表。按照回退顺序排列。"),
		output: Schema.union([
			Schema.const("prefer-user").description("优先使用用户语言"),
			Schema.const("prefer-channel").description("优先使用频道语言"),
		])
			.default("prefer-channel")
			.description("输出语言偏好设置。"),
	}).description("国际化设置");

	/** 语言 -> { 路径 -> 模板 } 的扁平化字典 */
	_data: Dict<Dict<string>> = {};
	/** 预置渲染器名 -> 渲染函数 */
	_presets: Dict<I18n.Renderer> = {};

	/** 可用语言树（决定 fallback 回退顺序） */
	locales: LocaleTree;

	ctx: Context;

	constructor(ctx: Context, config: I18n.Config = {}) {
		this.ctx = ctx;
		this.locales = LocaleTree.from(config.locales ?? []);
		defineBuiltInLocales(this);
	}

	/**
	 * 计算语言回退序列：输入一组偏好语言，输出按可用语言排列的查找顺序
	 * （如 zh-Hant 回退到 zh，再到配置的默认语言列表）。
	 */
	fallback(locales: string[]) {
		return fallback(this.locales, locales);
	}

	/**
	 * 模糊比对：以 Levenshtein 距离换算相似度（1 - 距离/期望长度），
	 * 低于阈值（minSimilarity）按完全不相似（0）处理。
	 */
	compare(expect: string, actual: string, options: CompareOptions = {}) {
		const value = 1 - distance(expect, actual) / expect.length;
		const threshold =
			options.minSimilarity ?? this.ctx.root.config.minSimilarity;
		return value >= threshold ? value : 0;
	}

	/** 取某条路径在各候选语言下的全部模板（按回退顺序，键为语言名）。 */
	get(key: string, locales: string[] = []): Dict<string> {
		const result: Dict<string> = {};
		for (const locale of this.fallback(locales)) {
			const value = this._data[locale]?.[key];
			if (value) result[locale] = value;
		}
		return result;
	}

	/**
	 * （内部）递归写入字典，以生成器逐个 yield 被写入的路径。
	 *
	 * 规则：
	 * - 对象递归展开为点分路径；`_` 开头的键视为私有元数据跳过；
	 * - 字符串写入 `_data[locale][path]`；对已有值且非 `$` 前缀语言的
	 *   覆盖记警告（`$` 前缀是"覆写语言"，允许覆盖）；
	 * - 其它类型（如显式 null）视为删除该路径。
	 */
	private *set(
		locale: string,
		prefix: string,
		value: I18n.Node,
	): Generator<string> {
		if (typeof value === "object" && value && !prefix.includes("@")) {
			for (const key in value) {
				if (key.startsWith("_")) continue;
				const child = value[key];
				if (child === undefined) continue;
				yield* this.set(locale, prefix + key + ".", child);
			}
		} else if (prefix.includes("@")) {
			throw new Error("preset is deprecated");
		} else if (typeof value === "string") {
			const dict = (this._data[locale] ??= {});
			const path = prefix.slice(0, -1);
			if (
				!isNullable(dict[path]) &&
				!locale.startsWith("$") &&
				dict[path] !== value
			) {
				logger.warn("override", locale, path);
			}
			dict[path] = value;
			yield path;
		} else {
			const dict = (this._data[locale] ??= {});
			delete dict[prefix.slice(0, -1)];
		}
	}

	/**
	 * 定义一组文案（对象字典或单条路径），返回撤销函数。
	 * 撤销动作挂在 ctx 的 i18n 收集器上，随调用方上下文销毁自动执行。
	 */
	define(locale: string, dict: I18n.Store): () => void;
	define(locale: string, key: string, value: I18n.Node): () => void;
	define(locale: string, dictOrKey: I18n.Store | string, value?: I18n.Node) {
		const dict = (this._data[locale] ??= {});
		const paths = [
			...(typeof dictOrKey === "string"
				? this.set(locale, dictOrKey + ".", value ?? "")
				: this.set(locale, "", dictOrKey)),
		];
		this.ctx.emit("internal/i18n");
		return this.ctx.collect("i18n", () => {
			for (const path of paths) {
				delete dict[path];
			}
			this.ctx.emit("internal/i18n");
		});
	}

	/**
	 * 在全部语言中按模式查找与 actual 相近的路径（如指令名纠错），
	 * 实现见 match.ts 的 findMatches。
	 */
	find<P extends string>(
		pattern: P,
		actual: string,
		options: I18n.FindOptions = {},
	): I18n.FindResult<P>[] {
		return findMatches(this, pattern, actual, options);
	}

	/**
	 * 渲染单个字典节点：字符串走 h.parse（支持 `{参数}` 插值与元素语法）；
	 * 带 kTemplate 的对象走预置渲染器，找不到渲染器则抛错。
	 */
	_render(value: I18n.Node, params: any, locale: string) {
		if (typeof value !== "string") {
			const preset = value[kTemplate];
			const render = preset === undefined ? undefined : this._presets[preset];
			if (!render) throw new Error(`Preset "${preset}" not found`);
			return [h.text(render(value, params, locale))];
		}

		return h.parse(value, params);
	}

	/** @deprecated 已废弃：请改用 {@link I18n.render}。 */
	text(locales: string[], paths: string[], params: object) {
		return this.render(locales, paths, params).join("");
	}

	/**
	 * 按语言回退顺序渲染文案：逐路径、逐语言尝试（先查 `$` 覆写语言再查
	 * 原语言）；全部未命中时记警告并以路径本身作为文本兜底（方便排查）。
	 */
	render(locales: string[], paths: string[], params: object) {
		locales = this.fallback(locales);

		// 逐个路径、逐个语言尝试渲染
		for (const path of paths) {
			for (const locale of locales) {
				for (const key of ["$" + locale, locale]) {
					const value = this._data[key]?.[path];
					if (value === undefined || (!value && !locale && path !== ""))
						continue;
					return this._render(value, params, locale);
				}
			}
		}

		// 路径未命中：输出路径本身并告警
		const path = paths[0] ?? "";
		logger.warn("missing", path);
		return [h.text(path)];
	}
}

export namespace I18n {
	/** i18n 服务配置。 */
	export interface Config {
		/** 可用语言列表（按回退顺序排列） */
		locales?: string[];
		/** 输出语言偏好：用户语言优先或频道语言优先 */
		output?: "prefer-user" | "prefer-channel";
		/** 模糊匹配时捕获参数的语言偏好（见 match.ts） */
		match?: "strict" | "prefer-input" | "prefer-output";
	}
}
