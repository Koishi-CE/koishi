/**
 * 主题服务：管理控制台的深浅色模式与主题注册。
 *
 * - 监听系统颜色偏好（auto 模式下自动跟随）；
 * - 向 <html> 写入 theme 属性与 dark 类，驱动 CSS 变量切换；
 * - 插件通过 `ctx.theme()` 注册主题，并可附带各插槽位的装饰组件。
 */
import { usePreferredDark } from "@vueuse/core";
import type { Dict } from "cosmokit";
import { type Component, computed, markRaw, reactive, watchEffect } from "vue";
import { Schema } from "../../../components/client/index.ts";
import type { Context } from "../context";
import { Service } from "../utils";
import { useConfig } from "./setting";

declare module "../context" {
	interface Context {
		$theme: ThemeService;
		theme(options: ThemeOptions): () => void;
	}

	interface Internal {
		themes: Dict<ThemeOptions>;
	}
}

declare module ".." {
	interface Config {
		theme: Config.Theme;
	}

	export namespace Config {
		export interface Theme {
			mode: "auto" | "dark" | "light";
			dark: string;
			light: string;
		}
	}
}

/** 主题注册选项：name 支持多语言文案，components 按插槽名提供装饰组件 */
export interface ThemeOptions {
	id: string;
	name: string | Dict<string>;
	components?: Dict<Component>;
}

// 系统级深色偏好（用户操作系统设置）
const preferDark = usePreferredDark();

const config = useConfig();

// 实际生效的颜色模式：配置为 auto 时跟随系统偏好
const colorMode = computed(() => {
	const mode = config.value.theme.mode;
	if (mode !== "auto") return mode;
	return preferDark.value ? "dark" : "light";
});

/** 获取当前生效的颜色模式（"dark" | "light"） */
export const useColorMode = () => colorMode;

export default class ThemeService extends Service {
	constructor(ctx: Context) {
		super(ctx, "$theme", true);
		ctx.mixin("$theme", ["theme"]);

		ctx.internal.themes = reactive({});

		ctx.settings({
			id: "appearance",
			title: "外观设置",
			order: 900,
			schema: Schema.object({
				theme: Schema.object({
					mode: Schema.union([
						Schema.const("auto").description("跟随系统"),
						Schema.const("dark").description("深色"),
						Schema.const("light").description("浅色"),
					])
						.default("auto")
						.description("主题偏好。"),
					dark: Schema.string()
						.role("theme", { mode: "dark" })
						.default("default-dark")
						.description("深色主题。"),
					light: Schema.string()
						.role("theme", { mode: "light" })
						.default("default-light")
						.description("浅色主题。"),
				}).description("主题设置"),
			}),
		});

		ctx.effect(() =>
			watchEffect(
				() => {
					if (!config.value.theme) return;
					const root = window.document.querySelector("html");
					if (!root) return;
					// 把当前主题名写到 <html theme="...">，并同步 dark 类；
					// 主题样式与深色变量均由 CSS 依据这两个标记选择
					root.setAttribute("theme", config.value.theme[colorMode.value]);
					if (colorMode.value === "dark") {
						root.classList.add("dark");
					} else {
						root.classList.remove("dark");
					}
				},
				{ flush: "post" },
			),
		);
	}

	/**
	 * 注册一个主题；返回取消注册函数。
	 * components 中的每个插槽组件仅在该主题被选中时启用，
	 * 用于注入背景装饰、挂件等随主题切换的界面元素。
	 */
	theme(options: ThemeOptions) {
		markRaw(options);
		for (const [type, component] of Object.entries(options.components || {})) {
			this.ctx.slot({
				type,
				disabled: () => config.value.theme[colorMode.value] !== options.id,
				component,
			});
		}
		return this.ctx.effect(() => {
			this.ctx.internal.themes[options.id] = options;
			return () => delete this.ctx.internal.themes[options.id];
		});
	}
}
