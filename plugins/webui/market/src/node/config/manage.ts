/**
 * @file koishi.yml 中本插件配置节点的定位与安全写回(config 域)。
 *
 * 模块职责:
 * - 在 loader 插件树里定位 market-next 自身的配置节点(支持任意 group 嵌套
 *   与 ~ 禁用前缀),返回 parent[key] 形态的引用;
 * - ensureMarketNextConfigDefaults / removeLegacyCollapsedGroupsConfig:
 *   启动时补默认值、清理废弃键(只改内存对象,写盘由调用方负责);
 * - updateMarketNextConfig:market/update-config RPC 的服务端,按白名单
 *   应用 patch、写盘,必要时只 reload 本插件而非整个宿主。
 *
 * 关键设计:
 * - 不信任"自己在 plugins 树的哪个位置":插件可能被用户挪进任意 group,
 *   所以每次都从 loader.config.plugins 全树搜索(含 identity 比对兜底);
 * - 写回走 configPatchKeys 白名单,防止 RPC 伪造改写其他配置;
 * - 变更仅涉及 idleProbe* 等运行时键时,通过 koishi 内部 loader.record
 *   找到持有该配置的父 Context,做单插件 reload,避免 fullReload 抖动。
 *
 * 架构位置:node 适配层 config 模块,被 setup.ts(启动迁移)与 console
 * listener market/update-config 消费。
 */
import type { Context } from "@koishi-ce/koishi";
import {
	type Config,
	configPatchKeys,
	configReloadKeys,
	normalizeMarketSilentRules,
} from "./index.js";
import type { PluginConfigMap } from "./plugins-map.js";

/**
 * 在插件运行时树中查找"配置对象 === plugins"的 Context:从入口 ctx 开始,
 * 借 koishi 内部 Symbol.for("koishi.loader.record") 的 fork 表递归下钻。
 * 找到它才能调 loader.reload(parent, key, value) 精确重载单个插件。
 */
function findPluginParentContext(
	ctx: Context | undefined,
	plugins: unknown,
): Context | undefined {
	if (!ctx) return;
	const scope = ctx.scope as unknown as {
		config?: unknown;
		[key: symbol]: unknown;
	};
	if (scope.config === plugins) return ctx;
	const record = scope[Symbol.for("koishi.loader.record")] as
		| Record<string, { ctx: Context }>
		| undefined;
	for (const fork of Object.values(record ?? {})) {
		const found = findPluginParentContext(fork.ctx, plugins);
		if (found) return found;
	}
	return;
}

/** market-next 配置在插件配置树中的定位（parent[key] === value）。 */
interface MarketNextConfigNode {
	parent: PluginConfigMap;
	key: string;
	value: {
		marketLayout?: unknown;
		collapsedGroups?: unknown;
		[key: string]: unknown;
	};
}

/**
 * 在插件配置树(含 group 嵌套)中定位 market-next 的配置节点:优先返回
 * 未禁用(~ 前缀)的匹配;只有禁用节点命中时作为 fallback 返回。匹配依据:
 * 引用与当前 Config 对象相同(identity 兜底),或键名是本插件的新旧短名。
 */
function findMarketNextConfigNode(
	plugins: unknown,
	currentConfig: Config,
): MarketNextConfigNode | undefined {
	let fallback: MarketNextConfigNode | undefined;
	for (const key in (plugins as PluginConfigMap) ?? {}) {
		if (key.startsWith("$")) continue;
		const value = (plugins as PluginConfigMap)[key];
		const candidate = getMarketConfigCandidate(
			plugins,
			key,
			value,
			currentConfig,
		);
		if (candidate?.isMatch) {
			if (!candidate.disabled) return candidate.node;
			fallback ||= candidate.node;
		}
		if (candidate?.isGroup) {
			const nested = findMarketNextConfigNode(value, currentConfig);
			if (nested) return nested;
		}
	}
	return fallback;
}

/** 单个候选键的判定:剥 ~ 前缀取插件短名,区分 group 节点与 market-next 命中。 */
function getMarketConfigCandidate(
	parent: unknown,
	key: string,
	value: unknown,
	currentConfig: Config,
) {
	if (!value || typeof value !== "object") return;
	const node = value as MarketNextConfigNode["value"];
	const disabled = key.startsWith("~");
	const normalized = disabled ? key.slice(1) : key;
	const [name] = normalized.split(":", 1);
	return {
		disabled,
		isGroup: name === "group",
		isMatch:
			value === currentConfig ||
			name === "market-next" ||
			name === "@koishi-ce/plugin-marketn",
		node: { parent: parent as PluginConfigMap, key, value: node },
	};
}

/**
 * 清理废弃键:删除已下线的 marketLayout 键(旧版市场布局配置)。只改内存
 * 中的配置对象,是否写盘由调用方(setup.ts)决定。
 *
 * @returns 是否有改动(有改动时调用方需要 writeConfig)
 */
export function ensureMarketNextConfigDefaults(
	ctx: Context,
	currentConfig: Config,
) {
	const target = findMarketNextConfigNode(
		ctx.loader.config?.plugins,
		currentConfig,
	);
	if (!target) return false;
	if (!Object.hasOwn(target.value, "marketLayout")) return false;
	delete target.value.marketLayout;
	return true;
}

/**
 * 删除废弃的 collapsedGroups 配置键(折叠状态已迁移到 market-next.json
 * 数据文件)。只改内存对象,写盘由调用方决定。
 *
 * @returns 是否删了该键
 */
export function removeLegacyCollapsedGroupsConfig(
	ctx: Context,
	currentConfig: Config,
) {
	const target = findMarketNextConfigNode(
		ctx.loader.config?.plugins,
		currentConfig,
	);
	if (!target || !Object.hasOwn(target.value, "collapsedGroups")) return false;
	delete target.value.collapsedGroups;
	return true;
}

/**
 * market/update-config RPC 的服务端:定位配置节点后按白名单应用 patch、
 * 写盘;涉及 idleProbe* 等运行时键时找到父 Context 做单插件 reload,
 * 最后刷新 console 的 config(必要时 entry)视图。
 *
 * @returns false = 没找到配置节点或 patch 不含白名单键;true = 应用成功
 * (含"键都在白名单但值没变"的幂等情况,此时不写盘)
 */
export async function updateMarketNextConfig(
	ctx: Context,
	currentConfig: Config,
	patch: Partial<Config>,
) {
	const target = findMarketNextConfigNode(
		ctx.loader.config?.plugins,
		currentConfig,
	);
	if (!target) return false;
	const changedKeys = applyConfigPatch(target.value, patch);
	if (!changedKeys) return false;
	if (!changedKeys.length) return true;
	await ctx.loader.writeConfig(true);
	const requiresReload = changedKeys.some((key) => configReloadKeys.has(key));
	if (requiresReload) {
		const parent = findPluginParentContext(ctx.loader.entry, target.parent);
		if (parent && !target.key.startsWith("~")) {
			await ctx.loader.reload(parent, target.key, target.value);
		}
	}
	await refreshConfigViews(ctx, requiresReload);
	return true;
}

/**
 * 按 configPatchKeys 白名单把 patch 写进目标配置对象。marketSilentRules
 * 入库前先归一化(兼容旧字段形态);仅当值确实变化才计入 changedKeys。
 *
 * @returns undefined = patch 不含任何白名单键(整体拒绝);
 *          空数组 = 有白名单键但值都未变(幂等成功,无需写盘)
 */
function applyConfigPatch(
	target: MarketNextConfigNode["value"],
	patch: Partial<Config>,
) {
	const targetRecord = target as Record<string, unknown>;
	const changedKeys: Array<keyof Config> = [];
	let accepted = false;
	for (const key of configPatchKeys) {
		if (!Object.hasOwn(patch, key)) continue;
		accepted = true;
		const value =
			key === "marketSilentRules"
				? normalizeMarketSilentRules(patch[key])
				: (patch[key] as never);
		if (targetRecord[key] === value) continue;
		targetRecord[key] = value;
		changedKeys.push(key);
	}
	return accepted ? changedKeys : undefined;
}

/** 刷新 console 视图:config 恒刷;发生过插件 reload 时补刷 entry(入口列表)。 */
async function refreshConfigViews(ctx: Context, requiresReload: boolean) {
	await ctx.get("console")?.refresh("config");
	if (requiresReload) await ctx.get("console")?.refresh("entry");
}
