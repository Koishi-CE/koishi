/**
 * @file 合包成员在 koishi.yml 里的配置写入器（market 域）。
 *
 * 合包成员的插件配置统一放进 `group:pa-*` 分组（$label 展示名 + $collapsed
 * 展开态 + 各成员节点）。成员配置键的形态为 `~短名:成员标识`：
 * - `~` 前缀让配置插件禁用自动重载（合包安装是多键变更,统一由安装完成后的
 *   刷新处理,避免每写一个键就重启一次插件）;
 * - `:成员标识` 后缀避免不同合包含同名插件时键冲突。
 *
 * 写入策略（configureBundleMember 逐成员执行）:
 * 1. createConfig=false → 跳过;
 * 2. 组内已有该短名的配置 → 跳过（不覆盖既有配置）;
 * 3. 组外存在同短名配置且勾了 move → 把节点搬进分组（保留原键,原键已被
 *   占用时改用合成键）;
 * 4. 否则新建节点,usePreset 时以清单预置 config 为初始值。
 *
 * write() 只执行一次（幂等防重入）:它同时被挂进安装器完成回调和安装后
 * 显式调用,回滚场景下回调不触发、显式调用在 code 非 0 时也不执行。
 */
import type { Context } from "@koishi-ce/koishi";
import type {
    BundleInstallMember,
    BundleInstallRequest,
    PluginBundleManifest,
} from "../../shared/bundle.js";
import {
    getBundleGroupIdent,
    getBundleMemberIdent,
    getPluginShortname,
} from "../../shared/bundle-idents.js";
import { findPluginConfigKey, type PluginConfigMap } from "../config/plugins-map.js";

/** 定位到的合包分组:key 为 group:pa-*,plugins 为分组内的配置映射。 */
export interface BundleGroup {
    key: string;
    plugins: PluginConfigMap;
    /** ensureBundleGroup 本次是否新建/补写了元数据（触发写盘的依据之一）。 */
    changed?: boolean;
}

/** 读取已存在的合包分组;未在 koishi.yml 配置该分组时返回 undefined。 */
export function getBundleGroup(ctx: Context, packageName: string): BundleGroup | undefined {
    const plugins = ctx.loader.config?.plugins as PluginConfigMap | undefined;
    if (!plugins) return;
    const key = `group:${getBundleGroupIdent(packageName)}`;
    const group = plugins[key] as PluginConfigMap | undefined;
    if (!group) return;
    return { key, plugins: group };
}

/**
 * 确保合包分组存在且带齐元数据:分组不存在则新建,缺 $label（清单 label
 * 或包短名）或 $collapsed（默认展开）则补写。koishi.yml 只读时返回
 * undefined——所有依赖它的写入路径都会降级为跳过。
 */
function ensureBundleGroup(
    ctx: Context,
    packageName: string,
    bundle: PluginBundleManifest,
): BundleGroup | undefined {
    const plugins = ctx.loader.config?.plugins as PluginConfigMap | undefined;
    if (!plugins || !ctx.loader.writable) return;
    const ident = getBundleGroupIdent(packageName);
    const key = `group:${ident}`;
    let changed = false;
    if (!plugins[key]) {
        plugins[key] = {};
        changed = true;
    }
    const group = plugins[key] as PluginConfigMap;
    if (!group["$label"]) {
        group["$label"] = bundle.label || getPluginShortname(packageName);
        changed = true;
    }
    if (group["$collapsed"] === undefined) {
        group["$collapsed"] = false;
        changed = true;
    }
    return { key, plugins: group, changed };
}

/** 分组内是否已有该短名的成员配置（沿 findPluginConfigKey 的键匹配规则）。 */
function hasPluginConfigInGroup(plugins: PluginConfigMap, shortname: string) {
    return findPluginConfigKey(plugins, shortname) !== undefined;
}

/**
 * 在整棵 koishi.yml 插件配置树里递归找同短名节点（组外配置探测用）。
 * 跳过 $ 元数据键;`group` 前缀的键视为分组容器继续下钻。返回节点及其
 * 父映射,便于后续原位删除完成"搬移"。
 */
function findPluginConfig(
    plugins: unknown,
    shortname: string,
): { key: string; parent: PluginConfigMap; value: unknown } | undefined {
    for (const key in (plugins as PluginConfigMap) ?? {}) {
        if (key.startsWith("$")) continue;
        const value = (plugins as PluginConfigMap)[key];
        const prefix = key.split(":", 1)[0]!;
        const name = prefix.replace(/^~/, "");
        if (name === shortname) return { key, parent: plugins as PluginConfigMap, value };
        if (name === "group") {
            const found = findPluginConfig(value, shortname);
            if (found) return found;
        }
    }
    return;
}

/**
 * 合包配置写入器:write 幂等（只执行一次）,group/configured/moved/skipped
 * 记录执行结果,供安装记录（PluginBundleRecord）与安装结果回显消费。
 */
export interface BundleConfigWriter {
    write: () => Promise<void>;
    group?: BundleGroup | undefined;
    configured: string[];
    moved: string[];
    skipped: string[];
}

/**
 * 创建写入器。write 首次调用时执行 writeBundleConfig,之后直接返回
 * （wrote 标记）——安装器完成回调与 installBundle 的显式调用无论谁先
 * 到、到几次,配置只写一轮。
 */
export function createBundleConfigWriter(
    ctx: Context,
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
    selected: BundleInstallMember[],
): BundleConfigWriter {
    const writer: BundleConfigWriter = {
        group: undefined,
        configured: [],
        moved: [],
        skipped: [],
        write: async () => {},
    };
    let wrote = false;
    writer.write = async () => {
        if (wrote) return;
        await writeBundleConfig(ctx, request, manifest, selected, writer);
        wrote = true;
    };
    return writer;
}

/**
 * 写配置的主流程:确保分组就绪（新建失败则退回读既有分组）,逐成员执行
 * configureBundleMember,任一成员产生了变更（分组元数据变动、新配置、
 * 搬移）才写盘,避免无谓的 koishi.yml 改写。
 */
async function writeBundleConfig(
    ctx: Context,
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
    selected: BundleInstallMember[],
    writer: BundleConfigWriter,
) {
    writer.group =
        ensureBundleGroup(ctx, request.package, manifest) ?? getBundleGroup(ctx, request.package);
    let groupChanged = !!writer.group?.changed;
    for (const member of selected) {
        groupChanged =
            configureBundleMember(ctx, request, manifest, member, writer) || groupChanged;
    }
    if (groupChanged || writer.configured.length || writer.moved.length) {
        await ctx.loader.writeConfig();
    }
}

/**
 * 单个成员的配置落位（返回是否产生写盘需要的变更）,策略见文件头。
 * 新建键为 `~短名:成员标识`;已存在同键（理论上只有重复安装会走到）时
 * 跳过不覆盖。usePreset 时初始值取成员 config,否则空对象。
 */
function configureBundleMember(
    ctx: Context,
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
    member: BundleInstallMember,
    writer: BundleConfigWriter,
) {
    if (!member.createConfig) {
        writer.skipped.push(member.package);
        return false;
    }
    const shortname = member.plugin || getPluginShortname(member.package);
    const ensured = ensureBundleGroup(ctx, request.package, manifest);
    writer.group ||= ensured;
    const groupChanged = !!ensured?.changed;
    if (!writer.group) {
        // koishi.yml 只读:分组都建不了,记跳过
        writer.skipped.push(member.package);
        return groupChanged;
    }
    if (hasPluginConfigInGroup(writer.group.plugins, shortname)) return groupChanged;

    const existing = findPluginConfig(ctx.loader.config?.plugins, shortname);
    if (existing && existing.parent !== writer.group.plugins && member.move) {
        return moveBundleMember(request, member, existing, writer) || groupChanged;
    }
    const ident = getBundleMemberIdent(request.package, member);
    const key = `~${shortname}:${ident}`;
    if (writer.group.plugins[key]) return groupChanged;
    writer.group.plugins[key] = member.usePreset ? member.config || {} : {};
    writer.configured.push(member.package);
    return true;
}

/**
 * 把组外已有配置搬进合包分组:优先保留原键（用户自定义的 :后缀 不动）,
 * 原键在组内已被占用时改用 `~短名:成员标识` 合成键;两种键都撞车则跳过。
 * 搬移 = 组内写入原 value + 组外原位删除。
 */
function moveBundleMember(
    request: BundleInstallRequest,
    member: BundleInstallMember,
    existing: { key: string; parent: PluginConfigMap; value: unknown },
    writer: BundleConfigWriter,
) {
    const shortname = member.plugin || getPluginShortname(member.package);
    const ident = getBundleMemberIdent(request.package, member);
    const fallbackKey = `~${shortname}:${ident}`;
    // 用 Object.hasOwn 判定键占用,避免原型链属性误判
    const targetKey = Object.hasOwn(writer.group!.plugins, existing.key)
        ? fallbackKey
        : existing.key;
    if (Object.hasOwn(writer.group!.plugins, targetKey)) {
        writer.skipped.push(member.package);
        return false;
    }
    writer.group!.plugins[targetKey] = existing.value ?? {};
    delete existing.parent[existing.key];
    writer.moved.push(member.package);
    return true;
}
