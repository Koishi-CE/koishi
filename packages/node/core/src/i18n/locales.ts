import enUS from "../../locales/en-US.yml";
import zhCN from "../../locales/zh-CN.yml";
import type { I18n } from "./index";

/** 装载内置语言包（空键位、简体中文、英语） */
export function defineBuiltInLocales(i18n: I18n) {
	i18n.define("", { "": "" });
	i18n.define("zh-CN", zhCN);
	i18n.define("en-US", enUS);
}
