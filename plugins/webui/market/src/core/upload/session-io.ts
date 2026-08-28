/**
 * @file 上传会话的 I/O 与输入校验工具(core/upload 域)。
 *
 * 职责:文件名/分块编码的严格校验(防路径穿越与伪造载荷)、字节格式化、
 * 过期临时文件清扫,以及归档"原子落位"(rename + 同名内容一致性校验)。
 * 被 LocalPackageUploadStore 与 local-binding 共用;只依赖 node:fs/path。
 */
import { promises as fsp } from "node:fs";
import { basename, resolve } from "node:path";
import { assertInside, readFileHash } from "./tar.js";

/** 约定的单块上限 512 KiB(client 按此切分,服务端据此拒收超长 base64)。 */
export const LOCAL_UPLOAD_CHUNK_SIZE = 512 * 1024;

/** 校验上传文件名:必须是纯 basename(无路径分隔)且以 .tgz 结尾,防路径穿越。 */
export function validateUploadFilename(value: unknown) {
    if (
        typeof value !== "string" ||
        basename(value) !== value ||
        !value.toLowerCase().endsWith(".tgz")
    ) {
        throw new Error("请选择 npm pack 生成的 .tgz 文件。");
    }
    return value;
}

/**
 * 解码 base64 分块:先做长度/字符集/填充的静态校验(长度上限按 base64 膨胀率
 * 从 LOCAL_UPLOAD_CHUNK_SIZE 反推,多留 4 字节容忍 padding),再 round-trip
 * 复核,杜绝畸形编码静默解码成错误字节。
 */
export function decodeBase64Chunk(value: unknown) {
    if (
        typeof value !== "string" ||
        value.length > Math.ceil(LOCAL_UPLOAD_CHUNK_SIZE / 3) * 4 + 4 ||
        value.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
    ) {
        throw new Error("本地插件上传分块编码无效。");
    }
    const buffer = Buffer.from(value, "base64");
    if (buffer.toString("base64") !== value) throw new Error("本地插件上传分块编码无效。");
    return buffer;
}

/** 字节数转人类可读(向上取整),用于错误提示中的进度展示。 */
export function formatUploadBytes(value: number) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KiB`;
    return `${Math.ceil(value / 1024 / 1024)} MiB`;
}

/** 清理过期的孤儿分片文件（不属于任何活跃会话且超过 TTL）。 */
export async function sweepTemporaryUploads(
    temporaryRoot: string,
    activePaths: Set<string>,
    now: number,
    ttl: number,
) {
    // 目录不存在视为无孤儿(首次上传/已被清理),不视为错误
    const entries = await fsp.readdir(temporaryRoot, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
        throw error;
    });
    await Promise.all(
        entries.map(async (entry) => {
            if (!entry.isFile() || !entry.name.endsWith(".part")) return;
            const path = resolve(temporaryRoot, entry.name);
            // 活跃会话的 .part 不能动:进程重启后内存会话丢失,只能靠 mtime 判定孤儿
            if (activePaths.has(path)) return;
            const stat = await fsp.stat(path);
            if (now - stat.mtimeMs <= ttl) return;
            await fsp.rm(path, { force: true });
        }),
    );
}

/** 原子落位：目标已存在则校验哈希一致，rename 竞态时复核。 */
export async function placeUploadArchive(
    root: string,
    sessionPath: string,
    targetFilename: string,
    hash: string,
) {
    const target = resolve(root, targetFilename);
    assertInside(root, target);
    const existing = await readFileHash(target);
    if (existing && existing !== hash) {
        // 同名但内容不同:说明 hash 冲突或文件被篡改,拒绝覆盖
        throw new Error("同名本地插件归档已存在，但文件内容不一致。");
    }
    if (!existing) {
        try {
            await fsp.rename(sessionPath, target);
        } catch (error) {
            // rename 失败可能是并发落位:若对方内容与本次一致则本次直接复用,否则抛错
            const concurrent = await readFileHash(target);
            if (concurrent !== hash) throw error;
            await fsp.rm(sessionPath, { force: true });
        }
    } else {
        // 目标已存在且内容一致:幂等复用,删除临时文件即可
        await fsp.rm(sessionPath, { force: true });
    }
    return target;
}
