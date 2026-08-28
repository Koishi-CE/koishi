/**
 * @file koishi.yml 旧配置 -> market-next.json 的一次性迁移计算（market 域）。
 *
 * 模块职责:buildMigrationPatch 纯函数——每类数据只在"文件里还没有"时
 * 迁入（不覆盖已有内容）;collapsedGroups 额外按版本号做一次键清理（删除
 * 废弃的 "installed" 折叠键）。patch 的应用、版本号回写与落盘时序由
 * MarketDataStore.migrateFromConfig 完成（见 data-store.ts）。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { PluginBundleRecord } from "../../shared/bundle.js";
import type { UpdateIgnoreRule } from "../../shared/update.js";
import type { MarketDataStorePayload } from "./data-store.js";
import { normalizeDict } from "./normalize.js";

/** collapsedGroups 迁移版本号:>= 1 表示已删除废弃的 "installed" 折叠键。 */
export const COLLAPSED_GROUPS_VERSION = 1;

/** migrateFromConfig 的 config 入参形态（koishi.yml 里的旧数据）。 */
export interface MarketMigrationConfig {
    updateIgnored?: Dict<string | UpdateIgnoreRule>;
    bundleRecords?: Dict<PluginBundleRecord>;
    collapsedGroups?: Dict<boolean>;
}

/** 迁移决策所需的文件侧现状（MarketDataStore 私有状态的只读快照）。 */
export interface MarketMigrationState {
    updateIgnored: Dict<string | UpdateIgnoreRule>;
    bundleRecords: Dict<PluginBundleRecord>;
    collapsedGroups: Dict<boolean>;
    /** 文件里是否出现过 collapsedGroups 键(区分"没这状态"与"空状态")。 */
    hasCollapsedGroupsState: boolean;
    /** collapsedGroups 迁移版本号(见 COLLAPSED_GROUPS_VERSION)。 */
    collapsedGroupsVersion: number;
}

/** 迁移计算结果:待应用的 patch 与版本号清理信号。 */
export interface MarketMigrationPlan {
    patch: Partial<MarketDataStorePayload>;
    /** 版本号清理执行后的新版本号;版本已达标无需清理时为 undefined。 */
    migratedVersion: number | undefined;
}

/**
 * 计算迁移 patch:每类数据只在文件侧为空且配置侧有值时迁入;版本号未达标
 * 时对 collapsedGroups 做 "installed" 键清理并返回新版本号（调用方据此
 * 回写状态并在 patch 之后立即落盘,防止清理重复执行）。
 */
export function buildMigrationPatch(
    state: MarketMigrationState,
    config: MarketMigrationConfig,
): MarketMigrationPlan {
    const patch: Partial<MarketDataStorePayload> = {};
    const migrateCollapsedGroups = state.collapsedGroupsVersion < COLLAPSED_GROUPS_VERSION;
    if (
        !Object.keys(state.updateIgnored).length &&
        Object.keys(config.updateIgnored ?? {}).length
    ) {
        patch.updateIgnored = config.updateIgnored ?? {};
    }
    if (
        !Object.keys(state.bundleRecords).length &&
        Object.keys(config.bundleRecords ?? {}).length
    ) {
        patch.bundleRecords = config.bundleRecords ?? {};
    }
    if (!state.hasCollapsedGroupsState) {
        patch.collapsedGroups = config.collapsedGroups ?? {};
    }
    if (migrateCollapsedGroups) {
        const collapsedGroups = normalizeDict<boolean>(
            patch.collapsedGroups ?? state.collapsedGroups,
        );
        delete collapsedGroups["installed"];
        patch.collapsedGroups = collapsedGroups;
    }
    return {
        patch,
        migratedVersion: migrateCollapsedGroups ? COLLAPSED_GROUPS_VERSION : undefined,
    };
}
