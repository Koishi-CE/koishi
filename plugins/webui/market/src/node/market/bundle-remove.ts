/**
 * @file 合包配置移除:removeBundleConfigs 函数族（market 域）。
 *
 * 模块职责:只清 koishi.yml 里合包分组成员的配置、不动依赖,分组清空后
 * 顺带删除空分组。
 *
 * 关键设计:
 * - 分组定位与成员配置键形态（`~短名:成员标识`,~ 前缀 = 禁用自动重载）
 *   的约定见 bundle-config.ts;
 * - 删除了非 ~ 前缀键（即插件可能正在运行）时延迟 1s 触发 fullReload
 *   让宿主生效。
 *
 * 契约面:removeBundleConfigs 经 bundle.ts 原样转发导出。
 */
import type { Context } from "@koishi-ce/koishi";
import type { BundleConfigRemoveRequest, BundleConfigRemoveResult } from "../../shared/bundle.js";
import { getPluginShortname } from "../../shared/bundle-idents.js";
import type { PluginConfigMap } from "../config/plugins-map.js";
import { refreshConsole } from "../console/refresh.js";
import { getBundleGroup } from "./bundle-config.js";

/**
 * 移除合包成员的插件配置（不动依赖）。定位 koishi.yml 的 group:pa-* 分组,
 * 删除指定成员（缺省为全部分组成员）的配置节点;分组清空后按请求删除空
 * 分组。有实际删除时写盘并刷新 config/packages 通道;删除了非 ~ 前缀键
 * （即插件可能正在运行）时延迟 1s 触发 fullReload 让宿主生效。
 */
export async function removeBundleConfigs(
    ctx: Context,
    request: BundleConfigRemoveRequest,
): Promise<BundleConfigRemoveResult> {
    const group = getBundleGroup(ctx, request.package);
    const result: BundleConfigRemoveResult = {
        groupKey: group?.key,
        removed: [],
    };
    // 找不到分组,或 koishi.yml 只读(如由外部编排器管理)时静默空结果
    if (!group || !ctx.loader.writable) return result;

    const memberNames = getBundleMemberNames(request);
    const removal = removeBundleMembers(group.plugins, memberNames);
    result.removed.push(...removal.removed);
    if (request.removeEmptyGroup !== false && hasNoBundleMembers(group.plugins)) {
        delete (ctx.loader.config as { plugins?: PluginConfigMap }).plugins![group.key];
        result.removedGroup = true;
    }

    if (result.removed.length || result.removedGroup) {
        await ctx.loader.writeConfig();
        await refreshConsole(ctx, ["config", "packages"]);
        if (removal.needsFullReload) {
            setTimeout(() => {
                if (ctx.scope.isActive) ctx.loader.fullReload();
            }, 1000);
        }
    }

    return result;
}

/** 把移除请求的成员列表归一成插件短名集合（plugin 键优先,缺省回包名短名）。 */
function getBundleMemberNames(request: BundleConfigRemoveRequest) {
    return new Set(
        (request.members ?? [])
            .map((member) => getPluginShortname(member.plugin || member.package))
            .filter(Boolean),
    );
}

/**
 * 就地删除分组里命中成员短名的配置键。键形态为 `~短名:标识` 或 `短名:标识`,
 * 先剥出短名再比对;空成员集合表示删除组内全部非 $ 键。删除了不带 ~ 前缀的
 * 键意味着插件实例可能已加载,标记 needsFullReload 让调用方触发完整重载。
 */
function removeBundleMembers(plugins: PluginConfigMap, memberNames: Set<string>) {
    const removed: string[] = [];
    let needsFullReload = false;
    for (const key of Object.keys(plugins)) {
        // $ 开头是分组元数据($label/$collapsed),不属于任何成员
        if (key.startsWith("$")) continue;
        const shortname = key.split(":", 1)[0]!.replace(/^~/, "");
        if (memberNames.size && !memberNames.has(shortname)) continue;
        delete plugins[key];
        removed.push(key);
        if (!key.startsWith("~")) needsFullReload = true;
    }
    return { removed, needsFullReload };
}

/** 分组是否只剩 $ 元数据键（没有成员配置,可整体删除）。 */
function hasNoBundleMembers(plugins: PluginConfigMap) {
    return Object.keys(plugins).every((key) => key.startsWith("$"));
}
