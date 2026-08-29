/**
 * 内置语言包装载。
 *
 * 从包根的 `locales/*.yml`（tsdown 的 copy loader 会原样拷入产物）
 * 导入中英文内置文案并注册到 i18n 服务，作为所有插件的兜底语言。
 */
import enUS from "../../locales/en-US.yml";
import zhCN from "../../locales/zh-CN.yml";
import type { I18n } from "./index.ts";

/** 装载内置语言包（空键位、简体中文、英语） */
export function defineBuiltInLocales(i18n: I18n) {
	// 空语言（""）注册空键位，保证完全无语言匹配时渲染链路可用
	i18n.define("", { "": "" });
	i18n.define("zh-CN", zhCN);
	i18n.define("en-US", enUS);
}
