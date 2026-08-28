/**
 * 安装日志的读取端：安装历史列表与单条日志详情。
 *
 * 读取策略双轨：优先读取随日志一并落盘的结构化元数据（.log.json，
 * InstallHistoryMetadata）；缺失时回退解析 .log 文本头部字段与完成标记
 * （legacy 格式，兼容旧版本产生的日志，解析实现出仓至 legacy.ts）。
 * 大文件按「头段 + 尾段」截断读取，避免把数十 MB 的日志整体载入内存。
 *
 * 协作关系：由 src/node 适配层在 RPC（market/install-history 等）中调用；
 * deps.activeFile/waitForWrite 来自 InstallLogStore，用于识别并等待正在写入的
 * 活跃会话；deps.cleanup 触发 retention 清理后再列目录。
 */
import { promises as fsp, type Stats } from "node:fs";
import { basename } from "node:path";
import type {
    InstallHistoryEntry,
    InstallHistoryMetadata,
    InstallHistoryStatus,
    InstallLogDetail,
    InstallLogger,
} from "../types.js";
import { parseLegacyInstallLog } from "./legacy.js";
import {
    getInstallLogDir,
    getInstallLogPath,
    INSTALL_LOG_DETAIL_LIMIT,
    INSTALL_LOG_HEAD_LIMIT,
    INSTALL_LOG_TAIL_LIMIT,
} from "./retention.js";
import { sanitizeInstallLogText } from "./store.js";

/** 读取端依赖面：日志器 + 与 InstallLogStore 共享的会话状态/清理入口。 */
export interface InstallLogReaderDeps {
    cwd: string;
    log: InstallLogger;
    /** 当前活跃会话的日志文件（正在写入时先等待落盘再读） */
    activeFile: () => string | undefined;
    /** 等待活跃会话的追加写入全部落盘 */
    waitForWrite: () => Promise<void>;
    /** 触发一次保留策略清理（列表前调用） */
    cleanup: () => Promise<void>;
}

/**
 * 读取 .log.json 元数据并校验有效性；文件不存在或内容损坏时返回 undefined
 * （调用方随后回退 legacy 文本解析）。
 */
async function readInstallLogMetadata(cwd: string, id: string, log: InstallLogger) {
    const file = getInstallLogPath(cwd, id);
    if (!file) return undefined;
    try {
        const metadata: InstallHistoryMetadata = JSON.parse(
            await fsp.readFile(`${file}.json`, "utf8"),
        );
        // 只信任 version/id/changes 三项齐全的元数据，防止误读半截写入的文件
        if (metadata?.version !== 1 || metadata.id !== id || !Array.isArray(metadata.changes))
            return undefined;
        return metadata;
    } catch (error) {
        if (
            (error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT" &&
            !(error instanceof SyntaxError)
        ) {
            log.debug(
                `failed to read install log metadata ${id}: ${error instanceof Error ? error.message : error}`,
            );
        }
        return undefined;
    }
}

/**
 * 读取日志正文：不超上限时整读；否则用文件句柄按偏移量读头段与尾段，
 * 中间以 "... N bytes omitted ..." 拼接并标记 truncated。
 */
async function readInstallLog(file: string, limit: number, headLimit: number, tailLimit: number) {
    const stat = await fsp.stat(file);
    if (stat.size <= limit) {
        return {
            content: await fsp.readFile(file, "utf8"),
            truncated: false,
            size: stat.size,
        };
    }
    const handle = await fsp.open(file, "r");
    try {
        // 尾段从文件末尾倒推，头尾可能重叠时优先保证头段完整
        const headSize = Math.min(headLimit, stat.size);
        const tailSize = Math.min(tailLimit, Math.max(0, stat.size - headSize));
        const head = Buffer.alloc(headSize);
        const tail = Buffer.alloc(tailSize);
        if (headSize) await handle.read(head, 0, headSize, 0);
        if (tailSize) await handle.read(tail, 0, tailSize, stat.size - tailSize);
        return {
            content: `${head.toString("utf8")}\n\n... ${stat.size - headSize - tailSize} bytes omitted ...\n\n${tail.toString("utf8")}`,
            truncated: true,
            size: stat.size,
        };
    } finally {
        await handle.close();
    }
}

/** 由元数据组装历史条目：元数据标记 running 但会话已不在活跃列表 → 视为残留，降级为 unknown。 */
function createInstallHistoryEntry(
    metadata: InstallHistoryMetadata,
    size: number,
    activeFile?: string,
): InstallHistoryEntry {
    const status: InstallHistoryStatus =
        metadata.status === "running" && basename(activeFile || "") !== metadata.id
            ? "unknown"
            : metadata.status;
    return {
        id: metadata.id,
        startedAt: metadata.startedAt,
        finishedAt: metadata.finishedAt,
        duration: metadata.finishedAt
            ? Math.max(0, metadata.finishedAt - metadata.startedAt)
            : undefined,
        status,
        deps: metadata.deps,
        forced: metadata.forced,
        installEndpoint: metadata.installEndpoint,
        size,
        changes: metadata.changes,
    };
}

/**
 * 组装单个日志的历史条目：活跃文件先等待写入；stat 失败（已删除）返回 undefined；
 * 元数据可用则直接组装，否则截头尾读文本走 legacy 解析。
 */
async function getInstallHistoryEntry(
    id: string,
    deps: InstallLogReaderDeps,
): Promise<InstallHistoryEntry | undefined> {
    const file = getInstallLogPath(deps.cwd, id);
    if (!file) return undefined;
    if (file === deps.activeFile()) await deps.waitForWrite();
    let stat: Stats;
    try {
        stat = await fsp.stat(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") throw error;
        return undefined;
    }
    const metadata = await readInstallLogMetadata(deps.cwd, id, deps.log);
    if (metadata) return createInstallHistoryEntry(metadata, stat.size, deps.activeFile());
    // 无元数据：只读头尾（头部字段 + 末尾完成标记）即可完成 legacy 解析
    const preview = await readInstallLog(
        file,
        INSTALL_LOG_HEAD_LIMIT + INSTALL_LOG_TAIL_LIMIT,
        INSTALL_LOG_HEAD_LIMIT,
        INSTALL_LOG_TAIL_LIMIT,
    );
    return parseLegacyInstallLog(id, preview.content, stat.size, deps.activeFile());
}

/**
 * 读取安装历史列表：先清理过期日志，再按 mtime 倒序取最近 count 条
 * （count 钳制在 1..50），目录不存在时返回空数组。
 */
export async function getInstallHistory(
    limit = 20,
    deps: InstallLogReaderDeps,
): Promise<InstallHistoryEntry[]> {
    await deps.cleanup();
    const count = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
    const dir = getInstallLogDir(deps.cwd);
    let files: Array<{ id: string; mtime: number }> = [];
    try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        files = (
            await Promise.all(
                entries
                    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
                    .map(async (entry) => ({
                        id: entry.name,
                        mtime: (await fsp.stat(`${dir}/${entry.name}`)).mtimeMs,
                    })),
            )
        )
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, count);
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
        throw error;
    }
    const records = await Promise.all(files.map((file) => getInstallHistoryEntry(file.id, deps)));
    return records.filter((item): item is InstallHistoryEntry => !!item);
}

/**
 * 读取单条日志详情：历史条目 + 正文（上限 512KiB，超限截头尾并标记 truncated；
 * 正文经 ANSI 清洗后返回）。id 非法或文件已消失时返回 undefined。
 */
export async function getInstallLogDetail(
    id: string,
    deps: InstallLogReaderDeps,
): Promise<InstallLogDetail | undefined> {
    const file = getInstallLogPath(deps.cwd, id);
    if (!file) return undefined;
    const entry = await getInstallHistoryEntry(id, deps);
    if (!entry) return undefined;
    const result = await readInstallLog(file, INSTALL_LOG_DETAIL_LIMIT, 128 * 1024, 384 * 1024);
    return {
        ...entry,
        content: sanitizeInstallLogText(result.content),
        truncated: result.truncated,
    };
}
