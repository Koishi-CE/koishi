import { watchEffect } from "vue";
import { createI18n } from "vue-i18n";
import type { Context } from "../context";
import { Service } from "../utils";
import { useConfig } from "./setting";

declare module "../context" {
	interface Context {
		$i18n: I18nService;
	}
}

// 客户端本地配置（未与服务端同步前的原始值）
const config = useConfig();

/**
 * 国际化服务：持有 vue-i18n 实例（默认回退语言 zh-CN），
 * 并监听本地配置中的 locale 变化实时切换界面语言。
 * 各扩展自身的语言包由 loader 加载时注入该实例。
 */
export default class I18nService extends Service {
	public i18n = createI18n({
		legacy: false,
		fallbackLocale: "zh-CN",
	});

	constructor(ctx: Context) {
		super(ctx, "$i18n", true);

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
}
