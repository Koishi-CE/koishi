import { validRange } from "semver";
import type {
    PluginBundleManifest,
    PluginBundleMember,
    PluginBundleValidation,
} from "./bundle-types.js";
import { BUNDLE_KEYWORD, BUNDLE_PACKAGE_RE, PLUGIN_PACKAGE_RE } from "./bundle-types.js";

/**
 * 合包清单的解析/校验纯函数族（与 bundle-types.ts 的类型、命名约定常量配套）。
 *
 * 宽松解析（parseBundleManifest）与严格校验（validateBundleManifest）两步分离：
 * 前者把 package.json 的 koishi.bundle 字段尽力解析成结构化清单（供 client 展示），
 * 后者对命名约定、关键字、成员字段逐项检查产出 errors/warnings（供安装前拦截）。
 * 本文件仅做解析/校验，不做任何 I/O；node 端与 client 端引用同一份判定函数，
 * 避免两端对清单规则的理解漂移。
 */

/** 判断包名是否符合合包命名约定（额外要求全小写，避免大写绕过正则）。 */
export function isBundlePackageName(name = "") {
    return name === name.toLowerCase() && BUNDLE_PACKAGE_RE.test(name);
}

/** 判断关键字列表中是否含有合包标识 market:package（大小写不敏感）。 */
export function hasBundleKeyword(keywords?: string[]) {
    return !!keywords?.some((keyword) => keyword.toLowerCase() === BUNDLE_KEYWORD);
}

/**
 * 宽口径的"疑似合包"判定：命名约定、关键字、koishi.bundle 字段任一命中即算。
 * 市场列表据此给条目打 bundle 徽标；具体校验仍以 validateBundleManifest 为准。
 */
export function isBundleLike(meta: {
    name?: string;
    keywords?: string[];
    koishi?: { bundle?: unknown };
}) {
    return (
        isBundlePackageName(meta.name) ||
        hasBundleKeyword(meta.keywords) ||
        !!parseBundleManifest(meta.koishi?.bundle)
    );
}

/**
 * 把 package.json 的 koishi.bundle 字段宽容解析为清单对象。
 * 任何非对象输入返回 undefined；成员字段类型不合法时取空值而非整份失败
 * （宽松解析配合 validateBundleManifest 收紧，两步分离便于展示"尽力解析"的结果）。
 */
export function parseBundleManifest(value: unknown): PluginBundleManifest | undefined {
    if (!isRecord(value)) return;
    const { label, description, members } = value;
    return {
        label: typeof label === "string" ? label : undefined,
        description: typeof description === "string" ? description : undefined,
        members: Array.isArray(members)
            ? (members.map(parseBundleMember).filter(Boolean) as PluginBundleMember[])
            : [],
    };
}

/** 解析单个成员：字段类型不符时给空串/undefined，非法条目由 filter(Boolean) 剔除。 */
function parseBundleMember(value: unknown): PluginBundleMember | undefined {
    if (!isRecord(value)) return;
    const { package: pkg, plugin, version, required, config } = value;
    return {
        package: typeof pkg === "string" ? pkg : "",
        plugin: typeof plugin === "string" ? plugin : "",
        version: typeof version === "string" ? version : "",
        required: required === true,
        config: isRecord(config) ? config : undefined,
    };
}

/** 窄化的普通对象判定（排除数组与 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 校验合包清单：包名命名、关键字、成员字段逐一检查，产出 errors（阻断）与
 * warnings（提示）。只有"疑似合包"（命名命中、声明了关键字或带 bundle 字段）
 * 才强制要求 pa-* 命名，普通插件包不受影响。纯函数，无副作用。
 *
 * @param packageName 合包 npm 包名
 * @param bundle 解析后的清单（可缺省，缺省报 missing koishi.bundle）
 * @param options.keyword 元数据是否声明了 market:package 关键字
 */
export function validateBundleManifest(
    packageName: string,
    bundle?: PluginBundleManifest,
    options: { keyword?: boolean } = {},
): PluginBundleValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedName = packageName.toLowerCase();
    if (packageName !== normalizedName) errors.push("package name must be lowercase");
    if (isBundlePackageName(packageName) || options.keyword || bundle) {
        if (!isBundlePackageName(packageName)) {
            errors.push(
                "bundle package name must be koishi-plugin-pa-* or @scope/koishi-plugin-pa-*",
            );
        }
    }
    if (!bundle) {
        errors.push("missing koishi.bundle");
        return { valid: false, errors, warnings };
    }
    if (!bundle.members.length) errors.push("koishi.bundle.members must not be empty");
    if (!options.keyword) warnings.push(`missing keyword "${BUNDLE_KEYWORD}"`);

    const seen = new Set<string>();
    const seenPackages = new Set<string>();
    const seenPlugins = new Set<string>();
    for (const [index, member] of bundle.members.entries()) {
        validateBundleMember(
            member,
            index,
            seen,
            seenPackages,
            seenPlugins,
            errors,
            warnings,
            packageName,
        );
    }

    return { valid: !errors.length, errors, warnings };
}

/**
 * 校验单个成员并就地写入 errors/warnings。三类去重集合分别用于：
 * package+plugin 组合完全重复（error）、同一包名重复列出（warning，
 * 允许同包不同 plugin 键）、plugin 键冲突（warning，配置键大小写不敏感）。
 */
function validateBundleMember(
    member: PluginBundleMember,
    index: number,
    seen: Set<string>,
    seenPackages: Set<string>,
    seenPlugins: Set<string>,
    errors: string[],
    warnings: string[],
    packageName: string,
) {
    const prefix = `members[${index}]`;
    const normalizedPackage = member.package.toLowerCase();
    if (!member.package) errors.push(`${prefix}.package is required`);
    else if (member.package !== normalizedPackage)
        errors.push(`${prefix}.package must be lowercase`);
    else if (!PLUGIN_PACKAGE_RE.test(member.package)) {
        errors.push(`${prefix}.package is not a valid Koishi plugin package name`);
    } else if (normalizedPackage === packageName.toLowerCase()) {
        // 防自引用：成员指向合包自身会造成安装时的循环依赖
        errors.push(`${prefix}.package must not reference the bundle package itself`);
    }

    if (!member.plugin) errors.push(`${prefix}.plugin is required`);
    else if (!/^(?:@[^/]+\/)?[0-9a-z][0-9a-z-]*(?:\/[0-9a-z][0-9a-z-]*)?$/.test(member.plugin)) {
        warnings.push(
            `${prefix}.plugin should use lowercase package-like keys to avoid config conflicts`,
        );
    }

    if (!member.version) errors.push(`${prefix}.version is required`);
    else if (!validRange(member.version.trim()))
        errors.push(`${prefix}.version is not a valid semver range`);

    // 组合键用 \n 分隔，避免包名与插件键拼在一起产生歧义碰撞
    const key = `${member.package}\n${member.plugin}`;
    if (seen.has(key)) errors.push(`${prefix} duplicates another member`);
    seen.add(key);
    if (member.package) {
        if (seenPackages.has(normalizedPackage))
            warnings.push(`${prefix}.package is listed more than once`);
        seenPackages.add(normalizedPackage);
    }
    if (member.plugin) {
        const normalizedPlugin = member.plugin.toLowerCase();
        if (seenPlugins.has(normalizedPlugin))
            warnings.push(`${prefix}.plugin may conflict with another member`);
        seenPlugins.add(normalizedPlugin);
    }
}
