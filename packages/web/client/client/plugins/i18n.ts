// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { type Dict } from "cosmokit";
import { watchEffect } from "vue";
import { createI18n } from "vue-i18n";
import type { Context } from "../context";
import { Service } from "../utils";
import { localeMessages } from "./messages";
import { useConfig } from "./setting";

// 词典装载/摘取工具已拆至 ./messages（断 i18n ↔ setting 环）；
// 此处按原公共 API 再导出，下游从本模块或 barrel 的导入不受影响
export {
	localeMessages,
	pickFrom,
	pickMessages,
} from "./messages";

declare module "../context" {
	interface Context {
		$i18n: I18nService;
	}
}

/**
 * 国际化服务：持有 vue-i18n 实例（默认回退语言 zh-CN），
 * 并监听本地配置中的 locale 变化实时切换界面语言。
 *
 * 宿主词典在实例创建时整体传入；各扩展自身的语言包由其 client
 * 入口调用 `ctx.$i18n.extend()` 深合并注入（vue-i18n 已被构建别名
 * 钉到宿主单实例，扩展与宿主共享同一 composer）。
 */
export default class I18nService extends Service {
	public i18n = createI18n({
		legacy: false,
		fallbackLocale: "zh-CN",
		messages: localeMessages,
	});

	constructor(ctx: Context) {
		super(ctx, "$i18n", true);
		instance = this;

		// 客户端本地配置（在构造期获取而非模块顶层，避免与
		// setting.ts 的循环依赖在模块求值顺序上踩 TDZ）
		const config = useConfig();

		// flush: "post" 确保在语言切换引起重渲染前完成 locale 写入
		ctx.effect(() =>
			watchEffect(
				() => {
					const locale = config.value.locale;
					if (locale) {
						this.i18n.global.locale.value = locale;
					}
				},
				{ flush: "post" },
			),
		);
	}

	/**
	 * 注入扩展语言包：按 locale 深合并进全局词典。
	 * 扩展应把自身的键收纳在独立命名空间（如 `explorer.*`）下，
	 * 避免与其他扩展或宿主词典冲突。
	 */
	extend(locale: string, messages: Dict) {
		this.i18n.global.mergeLocaleMessage(locale, messages);
	}

	/**
	 * 全局翻译函数（非组件上下文使用，如 activity 名的 getter 与
	 * echarts 等纯 ts 模块）。可携带位置插值参数。
	 */
	t(key: string, args?: unknown[]) {
		return this.i18n.global.t(key, args ?? []);
	}
}

// 服务实例的模块级引用：仅用于开发期 HMR 回调中定位热替换目标
let instance: I18nService | undefined;

// 开发模式下宿主词典 yml 改动即时热替换（accept 的路径须为静态字面量）；
// 用 merge 而非 set，以免覆盖扩展此前经 extend() 注入的同语种词条
if (import.meta.hot) {
	const replace = (locale: string) => (module: unknown) => {
		// 热替换模块的 default 导出即该语种的完整词典
		const messages = (
			module as { default?: Dict } | undefined
		)?.default;
		instance?.extend(locale, messages ?? {});
	};
	import.meta.hot.accept(
		"../locales/de-DE.yml",
		replace("de-DE"),
	);
	import.meta.hot.accept(
		"../locales/en-US.yml",
		replace("en-US"),
	);
	import.meta.hot.accept(
		"../locales/fr-FR.yml",
		replace("fr-FR"),
	);
	import.meta.hot.accept(
		"../locales/ja-JP.yml",
		replace("ja-JP"),
	);
	import.meta.hot.accept(
		"../locales/ru-RU.yml",
		replace("ru-RU"),
	);
	import.meta.hot.accept(
		"../locales/zh-CN.yml",
		replace("zh-CN"),
	);
	import.meta.hot.accept(
		"../locales/zh-TW.yml",
		replace("zh-TW"),
	);
}
