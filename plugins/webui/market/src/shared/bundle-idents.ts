/**
 * 合包标识派生与敏感配置扫描（shared 共享语言层）。
 *
 * 设计动机：合包安装要把成员配置写进 koishi.yml 的 `group:pa-*` 分组，
 * 插件配置键则用 `~短名:pa-合包-成员` 形式。这些标识必须在 node 端（写配置）
 * 与 client 端（bundle-install/bundle-uninstall 对话框定位分组与成员）派生出
 * 完全一致的字符串，故抽出为纯函数共享；标识统一小写归一化并截断长度，
 * 保证在配置键里安全可用。scanSensitiveConfig 也放在本文件：合包成员的
 * 预置 config 会原样写入用户配置，client 在应用前用它提示敏感键。
 * 注意：本模块未列入 shared/index.ts 出口，client 通过相对路径直接引用源文件。
 */

// fa69d5b 补注释时误删，此处恢复（getBundleMemberIdent / scanSensitiveConfig 依赖）。
import type { Dict } from "@koishi-ce/koishi";
import type { PluginBundleMember } from "./bundle.js";

/** 命中即视为敏感的配置键名（命令执行/文件路径/凭据/网络地址等）。 */
const SENSITIVE_RE =
    /(command|script|exec|shell|path|file|token|secret|password|sql|url|webhook|endpoint)/i;

/** 去掉插件包名的 koishi-plugin 前缀，得到配置用的短名（保留 @scope 部分）。 */
export function getPluginShortname(name: string) {
    return name.replace(/(koishi-|^@koishijs\/)plugin-/, "");
}

/** 把任意字符串归一化为可作配置键片段的标识：小写、去 @、非法字符转 -、截断到 48 字符。 */
export function normalizeBundleIdent(value: string) {
    return (
        value
            .toLowerCase()
            .replace(/^@/, "")
            .replace(/[^0-9a-z]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "bundle"
    );
}

/** 合包分组标识：koishi.yml 中写作 `group:pa-短名`（pa = 合包前缀，源自命名约定）。 */
export function getBundleGroupIdent(packageName: string) {
    return `pa-${normalizeBundleIdent(getPluginShortname(packageName))}`;
}

/** 成员配置键后缀标识：`pa-合包短名-成员短名`，用于 `~短名:标识` 形式的插件键消歧。 */
export function getBundleMemberIdent(
    packageName: string,
    member: Pick<PluginBundleMember, "package" | "plugin">,
) {
    return `pa-${normalizeBundleIdent(getPluginShortname(packageName))}-${normalizeBundleIdent(getPluginShortname(member.plugin || member.package))}`;
}

/**
 * 递归收集配置对象中命中敏感词的键路径（如 ["adapter.token","proxy.url"]）。
 * 只按键名判断、不看值，供 client 在应用合包预置配置前向用户提示。
 */
export function scanSensitiveConfig(value: unknown, path = ""): string[] {
    const result: string[] = [];
    if (!value || typeof value !== "object") return result;
    for (const [key, child] of Object.entries(value as Dict)) {
        const next = path ? `${path}.${key}` : key;
        if (SENSITIVE_RE.test(key)) result.push(next);
        result.push(...scanSensitiveConfig(child, next));
    }
    return result;
}
