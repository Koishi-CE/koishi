/**
 * @file market-next 插件配置节点的定位与读写(shared/plugin-config 域)。
 *
 * 从 store.config.plugins 里递归定位本插件的配置节点(findMarketNextConfig),
 * 在其上提供类型化的读取器与双写补丁(本地立即生效 + RPC 持久化)。
 */

import { ref } from "vue";
import { send, store } from "@koishi-ce/client";
import type {
	MarketSilentCustomRule,
	MarketSilentDateRule,
	MarketSilentRecentRule,
	MarketSilentRule,
	MarketSilentStatusRule,
} from "../../../src/shared/types";
import type { UpdatePolicy } from "./update-policy";
import { getMarketDataStore } from "./data-store";

/** 市场条目弹层当前打开的包名(空串表示关闭);安装开始前会被清空。 */
export const active = ref("");

/** 可通过 patchMarketNextConfig 下发的插件配置补丁形态。 */
export interface MarketNextConfigPatch extends UpdatePolicy {
	marketSilentStatusRules?: MarketSilentStatusRule[];
	marketSilentDateRules?: MarketSilentDateRule[];
	marketSilentRecentRules?: MarketSilentRecentRule[];
	marketSilentCustomRules?: MarketSilentCustomRule[];
	marketSilentRules?: MarketSilentRule[];
	marketSilentFilters?: string;
	idleProbe?: boolean;
	idleProbeDelay?: number;
	idleProbeBootDelay?: number;
	idleProbeInterval?: number;
	bulkMode?: boolean;
	removeConfig?: boolean;
	bundleRecords?: Record<string, any>;
}

// 用 type 交叉而非 interface：调用方多处把它传给 Record<string, any> 参数，
// 接口类型没有隐式 index signature 会报错，type 别名有
export type MarketNextConfig = MarketNextConfigPatch & {
	gravatar?: string;
	search?: {
		endpoint?: string;
		timeout?: number;
		autoRoute?: boolean;
		logLevel?: string;
	};
};

/**
 * 从 store.config.plugins 里定位本插件的配置节点;插件未配置时为 undefined。
 */
export function getMarketNextConfig(): MarketNextConfig | undefined {
	return findMarketNextConfig((store as any).config?.plugins);
}

/**
 * 当前生效的更新策略:全局开关取自插件配置(只挑已显式配置的键),
 * 逐包忽略记录(updateIgnored)始终以数据仓为准。
 */
export function getMarketNextPolicy(fallback?: {
	market?: UpdatePolicy;
}): UpdatePolicy {
	const pluginConfig = getMarketNextConfig();
	const data = getMarketDataStore();
	return {
		...pickExisting(pluginConfig, [
			"updateIgnoredPackages",
			"updateIgnoreDuration",
			"updateIgnoreVersions",
			"updateIgnorePrerelease",
		] satisfies Array<keyof UpdatePolicy>),
		updateIgnored: data.updateIgnored ?? {},
	};
}

/**
 * 可写形态的更新策略:把数据仓的 updateIgnored 同步进插件配置节点再返回,
 * 调用方对返回值的修改会直接反映到配置面板与后续 getMarketNextConfig 读取。
 */
export function getWritableMarketNextPolicy(fallback?: {
	market?: UpdatePolicy;
}): UpdatePolicy {
	const pluginConfig = getMarketNextConfig();
	const data = getMarketDataStore();
	data.updateIgnored ||= {};
	if (!pluginConfig) return { updateIgnored: data.updateIgnored };
	pluginConfig.updateIgnored = data.updateIgnored;
	return pluginConfig;
}

/** 批量模式开关(依赖页批量选择);未配置默认关闭。 */
export function getBulkMode(fallback?: { market?: { bulkMode?: boolean } }) {
	const pluginConfig = getMarketNextConfig();
	if (hasOwn(pluginConfig, "bulkMode")) {
		return !!pluginConfig.bulkMode;
	}
	return false;
}

/** 卸载依赖时是否顺带删除插件配置;未配置返回 undefined(由调用方决定)。 */
export function getRemoveConfig(fallback?: {
	market?: { removeConfig?: boolean };
}) {
	const pluginConfig = getMarketNextConfig();
	if (hasOwn(pluginConfig, "removeConfig")) {
		return pluginConfig.removeConfig;
	}
	return undefined;
}

/**
 * 更新插件配置:本地配置节点立即合并(配置面板即时生效),再异步发
 * market/update-config RPC 让服务端持久化;请求失败只告警并返回 false。
 */
export function patchMarketNextConfig(patch: Partial<MarketNextConfigPatch>) {
	const pluginConfig = getMarketNextConfig();
	if (pluginConfig) Object.assign(pluginConfig, patch);
	const task = send("market/update-config", patch);
	if (!task) return Promise.resolve(false);
	return task.catch((error) => {
		console.error(error);
		return false;
	});
}

/**
 * 在插件配置树里递归查找本插件的节点:
 * - 键以 $ 开头的是注释/元信息,跳过;
 * - 键以 ~ 开头表示插件被禁用,记作 fallback 备选;
 * - 支持嵌套在 group 分组里的配置;
 * 优先返回启用节点的配置,全部被禁用时返回最后一个禁用节点(保证还能读写)。
 */
function findMarketNextConfig(plugins: any): any {
	let fallback: any;

	function visit(object: any): any {
		if (!object || typeof object !== "object") return;
		for (const rawKey of Object.keys(object)) {
			if (rawKey.startsWith("$")) continue;
			const value = object[rawKey];
			if (!value || typeof value !== "object") continue;
			const disabled = rawKey.startsWith("~");
			const key = disabled ? rawKey.slice(1) : rawKey;
			const name = key.split(":", 1)[0];
			if (name === "market-next" || name === "@koishi-ce/plugin-marketn") {
				if (!disabled) return value;
				fallback ||= value;
			}
			if (name !== "group") continue;
			const nested = visit(value);
			if (nested) return nested;
		}
	}

	return visit(plugins) ?? fallback;
}

/** 从对象里挑出"显式存在"的键组成子对象(undefined 但存在的键会保留)。 */
function pickExisting<T extends object, K extends keyof T>(
	source: T,
	keys: K[],
): Partial<Pick<T, K>> {
	const result: Partial<Pick<T, K>> = {};
	for (const key of keys) {
		if (hasOwn(source, key)) {
			result[key] = source[key];
		}
	}
	return result;
}

/** Object.prototype.hasOwnProperty 的类型安全包装,并收窄 undefined 源。仅供本域子模块共享。 */
export function hasOwn<T extends object, K extends PropertyKey>(
	source: T | undefined,
	key: K,
): source is T & Record<K, unknown> {
	return !!source && Object.prototype.hasOwnProperty.call(source, key);
}
