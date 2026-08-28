/**
 * @file market 域工具聚合出口。
 *
 * 原单文件 utils.ts 按职责拆为 context/catalog/similarity/sort/filter 五个
 * 子模块,此处按拆分前的导出面原样聚合 re-export(含 avatar/users 的历史
 * 转发),消费方的导入路径('./utils'/'../utils'/'../../market/utils')与
 * 符号名不变。similarity 的打分细节不进聚合面。
 */

export * from "./avatar";
export type { Badge } from "./catalog";
export {
	badges,
	canInstallBundleSearchObject,
	categories,
	isBundleSearchObject,
	resolveCategory,
} from "./catalog";
export type { MarketConfig } from "./context";
export {
	formatShortname,
	isPluginPackage,
	kConfig,
	useMarketI18n,
} from "./context";
export {
	getFiltered,
	getSilentFiltered,
	getVisible,
	hasFilter,
	parseSilentFilters,
	validate,
	validateWord,
} from "./filter";
export { comparators, getSortedPrepared } from "./sort";
export { getUserKey, getUsers } from "./users";
