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

const config = useConfig();

export default class I18nService extends Service {
	public i18n = createI18n({
		legacy: false,
		fallbackLocale: "zh-CN",
	});

	constructor(ctx: Context) {
		super(ctx, "$i18n", true);

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
