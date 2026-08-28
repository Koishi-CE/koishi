/**
 * @file market-next 前端的 i18n 装配层(shared 域)。
 *
 * 模块职责:
 * - 汇总全部中英文文案包(common/dependencies/marketPage/operations/...),
 *  以 `marketNext` 为命名空间挂到 vue-i18n 全局 composer 上;
 * - 对外提供 useMarketNextI18n()(组件内组合式用法,key 自动加命名空间前缀)
 *  与 translate()(非组件上下文的命令式翻译,如 actions.ts / operations.ts)。
 *
 * 关键设计:
 * - 所有文案在 i18n-runtime 的 namespace guard 保护下注册——旧版 bundle 通过
 *  setLocaleMessage 恢复快照时会抹掉本插件的词条,guard 会在每次 set 后自动补齐;
 * - lazy 注册:translate 首次调用时 ensure 一遍词条,不依赖入口先调用 register。
 */

import type { Context } from "@koishi-ce/client";
import { useI18n } from "vue-i18n";
import enMarket from "../market/locales/en-US.yml";
import zhMarket from "../market/locales/zh-CN.yml";
import {
	ensureLocaleNamespace,
	installLocaleNamespaceGuard,
	type LocaleMessageComposer,
} from "./i18n-runtime";
import enBundle from "./locales/en-US/bundle.yml";
import enCommon from "./locales/en-US/common.yml";
import enDependencies from "./locales/en-US/dependencies.yml";
import enDependencyCard from "./locales/en-US/dependency-card.yml";
import enEnvironment from "./locales/en-US/environment.yml";
import enExtensions from "./locales/en-US/extensions.yml";
import enMarketPage from "./locales/en-US/market-page.yml";
import enOperations from "./locales/en-US/operations.yml";
import zhBundle from "./locales/zh-CN/bundle.yml";
import zhCommon from "./locales/zh-CN/common.yml";
import zhDependencies from "./locales/zh-CN/dependencies.yml";
import zhDependencyCard from "./locales/zh-CN/dependency-card.yml";
import zhEnvironment from "./locales/zh-CN/environment.yml";
import zhExtensions from "./locales/zh-CN/extensions.yml";
import zhMarketPage from "./locales/zh-CN/market-page.yml";
import zhOperations from "./locales/zh-CN/operations.yml";

/** 本插件在全局 i18n 里的命名空间,所有 key 都以 `marketNext.` 开头。 */
const namespace = "marketNext";
/** 两语言 × 九个文案域的词条表,结构为 locale → 域名 → yml 模块。 */
const localeMessages = {
	"zh-CN": {
		common: zhCommon,
		dependencies: zhDependencies,
		marketPage: zhMarketPage,
		operations: zhOperations,
		dependencyCard: zhDependencyCard,
		extensions: zhExtensions,
		bundle: zhBundle,
		environment: zhEnvironment,
		market: zhMarket,
	},
	"en-US": {
		common: enCommon,
		dependencies: enDependencies,
		marketPage: enMarketPage,
		operations: enOperations,
		dependencyCard: enDependencyCard,
		extensions: enExtensions,
		bundle: enBundle,
		environment: enEnvironment,
		market: enMarket,
	},
};

type Composer = ReturnType<typeof useI18n>["t"];

/**
 * 全局 composer 的最小接口声明:只依赖读/合并/覆盖三个方法,
 * 避免直接耦合 vue-i18n 内部类型。
 */
interface GlobalComposer {
	t: Composer;
	getLocaleMessage: LocaleMessageComposer["getLocaleMessage"];
	mergeLocaleMessage: LocaleMessageComposer["mergeLocaleMessage"];
	setLocaleMessage: LocaleMessageComposer["setLocaleMessage"];
}

/** 懒持有的全局 composer:register 或 useMarketNextI18n 任一先被调用即赋值。 */
let globalComposer: GlobalComposer | undefined;

/** 确保全局 composer 上存在完整词条(缺失的 locale 域会补合并)。 */
function ensureMarketNextI18n(composer: GlobalComposer) {
	return ensureLocaleNamespace(composer, namespace, localeMessages);
}

/**
 * 入口注册:抓取 console 的全局 i18n composer 并安装 namespace guard,
 * 使后续任何 setLocaleMessage(旧 bundle 恢复快照)都不会丢掉本插件词条。
 */
export function registerMarketNextI18n(ctx: Context) {
	const composer = ctx.$i18n.i18n.global as unknown as GlobalComposer;
	globalComposer = composer;
	installLocaleNamespaceGuard(composer, namespace, localeMessages);
}

/**
 * 组件内组合式翻译:绑定全局作用域,返回的 t 会给 key 自动加
 * `marketNext.` 前缀,locale 供日期本地化等场景直接使用。
 */
export function useMarketNextI18n() {
	const composer = useI18n({
		useScope: "global",
	}) as unknown as GlobalComposer & ReturnType<typeof useI18n>;
	globalComposer = composer;
	installLocaleNamespaceGuard(composer, namespace, localeMessages);
	const { t: baseT, locale } = composer;
	const t = (key: string, ...args: any[]) =>
		(baseT as any)(`${namespace}.${key}`, ...args);
	return { t, locale };
}

/** 非组件上下文的命令式翻译(composer 尚未就绪时原样返回 key)。 */
export function translate(key: string, ...args: any[]) {
	if (!globalComposer) return key;
	ensureMarketNextI18n(globalComposer);
	return (globalComposer.t as any)(`${namespace}.${key}`, ...args);
}
