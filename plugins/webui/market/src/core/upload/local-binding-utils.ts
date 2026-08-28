/**
 * @file 本地插件绑定的纯校验/命名工具(core/upload 域)。
 *
 * 从 local-binding.ts 拆出:npm pack --json 输出解析、归档文件名白名单
 * 校验、file: 依赖串与内容哈希文件名生成,以及绑定前置校验
 * (assertBindableDependency)。全部为无 I/O 的纯函数,被 local-binding.ts
 * 主流程(打包与落位)与 tar.ts 的规范命名逻辑共用。
 */
import { basename } from "node:path";
import type { Dict } from "@koishi-ce/koishi";
import type { Dependency } from "../deps/types.js";
import type { PackageManifestSnapshot } from "../install/sources/manifest-restore.js";
import { Scanner } from "../registry/manifest.js";

/** 归档大小上限 64 MiB(与上传路径共用同一上限,防止打包超大目录)。 */
export const MAX_LOCAL_BINDING_PACK_SIZE = 64 * 1024 * 1024;

/** npm pack --json 单条产物记录的解析结果。 */
export interface LocalBindingPackResult {
    /** 包名(npm pack 输出缺省时为 undefined) */
    name?: string | undefined;
    /** 版本(npm pack 输出缺省时为 undefined) */
    version?: string | undefined;
    /** 产物文件名(已通过白名单正则校验) */
    filename: string;
    /** 产物字节数 */
    size: number;
}

/** 解析 npm pack --json 的输出，校验文件名与大小。 */
export function parseNpmPackOutput(output: string): LocalBindingPackResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output);
    } catch {
        throw new Error("invalid npm pack output");
    }
    const item = Array.isArray(parsed) ? parsed[0] : undefined;
    if (!item || typeof item !== "object") throw new Error("invalid npm pack output");
    const record = item as {
        filename?: unknown;
        size?: unknown;
        name?: unknown;
        version?: unknown;
    };
    const filename = validatePackFilename(record.filename);
    const size = Number(record.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_LOCAL_BINDING_PACK_SIZE) {
        throw new Error("invalid npm pack size");
    }
    return {
        name: typeof record.name === "string" ? record.name : undefined,
        version: typeof record.version === "string" ? record.version : undefined,
        filename,
        size,
    };
}

/** 由规范文件名生成 package.json 用的 file: 协议依赖串(相对宿主目录)。 */
export function createLocalBindingRequest(filename: string) {
    return `file:.yarn/local/${validatePackFilename(filename)}`;
}

/**
 * 在文件名尾部嵌入内容 hash:xxx-<hash12>.tgz。同内容必同名,归档天然幂等;
 * hash 必须是 12-64 位十六进制,防伪造后缀绕过规范命名。
 */
export function createHashedLocalBindingFilename(filename: string, hash: string) {
    const safeFilename = validatePackFilename(filename);
    if (!/^[a-f0-9]{12,64}$/i.test(hash)) throw new Error("invalid npm pack hash");
    return `${safeFilename.slice(0, -4)}-${hash.toLowerCase()}.tgz`;
}

/** 文件名白名单校验:纯 basename、仅限安全字符集且以 .tgz 结尾。 */
function validatePackFilename(value: unknown) {
    if (
        typeof value !== "string" ||
        basename(value) !== value ||
        !/^[a-z0-9@._+-]+\.tgz$/i.test(value)
    ) {
        throw new Error("invalid npm pack filename");
    }
    return value;
}

/** 前置校验：name 必须是 package.json 中来源未绑定的本地插件依赖。 */
export function assertBindableDependency(
    name: string,
    packageSnapshot: PackageManifestSnapshot,
    depCache: Dict<Dependency>,
): Dependency & { resolved: string } {
    if (!Scanner.isPlugin(name) || !Object.hasOwn(packageSnapshot.dependencies, name)) {
        throw new Error("只能绑定当前 package.json 中的 Koishi 插件依赖。");
    }
    const dependency = depCache[name];
    if (!dependency?.resolved || dependency.source !== "unbound") {
        throw new Error("该插件不是来源未绑定的本地插件。");
    }
    const currentRequest = packageSnapshot.dependencies[name]!.replace(/^[~^]/, "");
    // 快照与 depCache 的请求串必须一致:不一致说明 package.json 刚被改过,判定基准已失效
    if (dependency.request !== currentRequest) {
        throw new Error("package.json 已发生变化，请刷新依赖后重试。");
    }
    return dependency as Dependency & { resolved: string };
}
