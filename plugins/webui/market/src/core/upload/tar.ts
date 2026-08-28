/**
 * @file 本地归档(.tgz)的安全检视与命名工具(core/upload 域)。
 *
 * 职责:在不解压落盘的前提下流式扫描 tar 归档,读出根部 package/package.json
 * 并校验(条目数/解压总量上限防 zip 炸弹,路径与类型校验防穿越/符号链接),
 * 生成 .yarn/local 规范文件名,以及哈希读取与路径越界断言。
 * 被 session.ts(finish 校验)与 session-io.ts(placeUploadArchive)消费。
 */
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { dirname, relative } from "node:path";
import type { PackageJson } from "@koishi-ce/registry";
import { valid } from "semver";
import { list } from "tar";
import { Scanner } from "../registry/manifest.js";
import { createHashedLocalBindingFilename } from "./local-binding.js";

/** 条目数上限:防"海量小文件"型归档拖垮扫描。 */
const MAX_ARCHIVE_ENTRIES = 8192;
/** 解压后总字节上限:防解压炸弹(tar 层另有 200:1 压缩比限制)。 */
const MAX_ARCHIVE_EXPANDED_SIZE = 256 * 1024 * 1024;
/** package.json 本身的大小上限(只关心清单,超 1 MiB 即异常)。 */
const MAX_PACKAGE_MANIFEST_SIZE = 1024 * 1024;

/** 校验并读取 .tgz 归档根部的 package/package.json（防解压炸弹/路径穿越/符号链接）。 */
export async function inspectPackageArchive(path: string): Promise<PackageJson> {
    let entryCount = 0;
    let expandedSize = 0;
    let manifestFound = false;
    // onReadEntry 由 tar 的事件循环触发,同步 throw 会逸出为 uncaughtException
    // (await list() 的 try/catch 接不住)——违规一律记标志并把条目标记为
    // ignore(list 会自动 resume,数据被丢弃、tar 正常走完),扫描结束后统一
    // 抛错,错误才能经正常 reject 回到调用方。
    let violation: string | undefined;
    const chunks: Buffer[] = [];

    try {
        // list 只读元数据不打散到磁盘;manifest 内容通过 onReadEntry 的 data 事件收集
        await list({
            file: path,
            strict: true,
            maxReadSize: 1024 * 1024,
            maxMetaEntrySize: 1024 * 1024,
            maxDecompressionRatio: 200,
            onReadEntry(entry) {
                // 已命中违规后只消费剩余数据流,不再重复校验/收集
                if (violation) return;
                entryCount++;
                expandedSize += Number(entry.size) || 0;
                if (entryCount > MAX_ARCHIVE_ENTRIES || expandedSize > MAX_ARCHIVE_EXPANDED_SIZE) {
                    violation = "本地插件归档解压后内容过大或文件数量过多。";
                    entry.ignore = true;
                    return;
                }
                const invalid = validateArchiveEntry(entry.path, entry.type);
                if (invalid) {
                    violation = invalid;
                    entry.ignore = true;
                    return;
                }
                // 只认归档根部(npm pack 约定)的 package/package.json,其余条目跳过
                if (entry.path.replace(/\\/g, "/") !== "package/package.json") return;
                if (manifestFound) {
                    violation = "本地插件归档包含重复的 package.json。";
                    entry.ignore = true;
                    return;
                }
                if (entry.size <= 0 || entry.size > MAX_PACKAGE_MANIFEST_SIZE) {
                    violation = "本地插件 package.json 大小无效。";
                    entry.ignore = true;
                    return;
                }
                manifestFound = true;
                entry.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            },
        });
    } catch (error) {
        // 违规条目声明体积超出实际数据时,tar 会以读取错误提前中止;
        // 此时 violation 已记录,优先抛出防护文案而不是包装成读取失败
        if (violation) throw new Error(violation);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法读取本地插件归档：${detail}`);
    }

    if (violation) throw new Error(violation);
    if (!manifestFound)
        throw new Error("本地插件归档中缺少 package/package.json。请使用 npm pack 生成 .tgz。");
    let manifest: PackageJson;
    try {
        manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Error("本地插件 package.json 不是有效的 JSON。");
    }
    if (!manifest || typeof manifest !== "object") throw new Error("本地插件 package.json 无效。");
    if (typeof manifest.name !== "string" || !Scanner.isPlugin(manifest.name)) {
        throw new Error("归档中的包名不是有效的 Koishi 插件名称。");
    }
    if (typeof manifest.version !== "string" || !valid(manifest.version)) {
        throw new Error("归档中的插件版本不是有效的 SemVer。");
    }
    return manifest;
}

/**
 * 校验单个归档条目:必须位于 package/ 前缀下、不得包含 .. 或绝对路径
 * (防路径穿越),且类型只能是普通文件/目录(符号链接与设备节点一律拒绝)。
 * 返回违规描述;合法时返回 undefined(不抛错——调用方在事件回调里,抛错会逸出)。
 */
function validateArchiveEntry(value: string, type: string): string | undefined {
    const path = value.replace(/\\/g, "/");
    const parts = path.split("/").filter(Boolean);
    if (!path || path.startsWith("/") || parts[0] !== "package" || parts.includes("..")) {
        return `本地插件归档包含非法路径：${value}`;
    }
    if (
        type === "SymbolicLink" ||
        type === "Link" ||
        type === "CharacterDevice" ||
        type === "BlockDevice" ||
        type === "FIFO"
    ) {
        return `本地插件归档包含不允许的条目类型：${type}`;
    }
    return undefined;
}

/** 生成 .yarn/local 下的规范归档文件名（含内容 hash 前缀）。 */
export function createCanonicalLocalPackageFilename(name: string, version: string, hash: string) {
    // scope 名(@a/b)压平成 a-b,再剔除文件名不安全字符并截断到 120 字符
    const slug = name
        .replace(/^@/, "")
        .replace(/[\\/]+/g, "-")
        .replace(/[^a-z0-9@._+-]+/gi, "-")
        .slice(0, 120);
    return createHashedLocalBindingFilename(`${slug}-${version}.tgz`, hash.slice(0, 12));
}

/** 读取文件内容 sha256；不存在返回 undefined。 */
export async function readFileHash(path: string) {
    try {
        const stat = await fsp.stat(path);
        if (!stat.isFile()) throw new Error("本地插件归档目标不是文件。");
        return createHash("sha256")
            .update(await fsp.readFile(path))
            .digest("hex");
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
        throw error;
    }
}

/** 断言 target 就在 root 目录内(同名一层),防止拼接出的落盘路径越界。 */
export function assertInside(root: string, target: string) {
    if (dirname(target) !== root || relative(root, target).startsWith("..")) {
        throw new Error("本地插件归档目标路径无效。");
    }
}
