/**
 * 安装日志的目录定位与保留策略（清理入口）。
 *
 * 职责：提供 `data/market-next-install-logs/` 目录与日志文件路径的统一解析
 * （含 id 合法性校验，防路径穿越）、保留时长计算（新旧配置字段兼容）、
 * 以及周期性清理（删除超期 .log/.log.json，跳过正在写入的活跃会话）。
 *
 * 协作关系：store.ts 每次启动新日志前调用 cleanup；reader.ts 读取历史时也
 * 会触发一次清理（deps.cleanup），保证列表不出现即将过期的条目。
 */
import { promises as fsp } from "node:fs";
import { basename, resolve } from "node:path";
import { DAY, HOUR } from "../../utils/time.js";
import type { InstallLogger } from "../types.js";

/** 日志目录名（位于宿主 data/ 下）。 */
const INSTALL_LOG_DIR = "market-next-install-logs";
/** 单条日志详情的读取上限：超过则截断（512KiB）。 */
export const INSTALL_LOG_DETAIL_LIMIT = 512 * 1024;
/** legacy 解析 / 列表场景的头段读取上限（8KiB）。 */
export const INSTALL_LOG_HEAD_LIMIT = 8 * 1024;
/** 尾段读取上限（32KiB）：完成状态行通常在文件末尾。 */
export const INSTALL_LOG_TAIL_LIMIT = 32 * 1024;
/** 未配置保留时长时的默认值：3 天。 */
const DEFAULT_INSTALL_LOG_RETENTION = 3 * DAY;

/** 日志目录绝对路径（cwd/data/market-next-install-logs）。 */
export function getInstallLogDir(cwd: string) {
    return resolve(cwd, "data", INSTALL_LOG_DIR);
}

/**
 * 由 id（即日志文件名）解析绝对路径；id 必须是纯文件名且以 .log 结尾，
 * 否则返回 undefined——防止调用方传入路径穿越串（如 ../evil.log）逃出日志目录。
 */
export function getInstallLogPath(cwd: string, id: string) {
    if (!id || basename(id) !== id || !id.endsWith(".log")) return undefined;
    return resolve(getInstallLogDir(cwd), id);
}

/** 安装日志保留时长：新字段优先，回退 deprecated 字段，最终默认 3 天。 */
export function getInstallLogRetention(config: {
    installLogRetentionHours?: number | undefined;
    installLogRetention?: number | undefined;
}) {
    const hours = Number(config.installLogRetentionHours);
    if (Number.isFinite(hours) && hours > 0) return Math.max(1, hours) * HOUR;
    const legacyRetention = Number(config.installLogRetention);
    return Number.isFinite(legacyRetention) && legacyRetention > 0
        ? Math.max(HOUR, legacyRetention)
        : DEFAULT_INSTALL_LOG_RETENTION;
}

/** 安装日志清理：删除超过保留时长的 .log/.log.json（跳过活跃会话）。 */
export class InstallLogRetention {
    /** 进行中的清理任务（并发调用 cleanup 时去重复用）。 */
    private task: Promise<void> | undefined;
    private readonly cwd: string;
    private readonly getRetention: () => number;
    private readonly log: InstallLogger;

    constructor(cwd: string, getRetention: () => number, log: InstallLogger) {
        this.cwd = cwd;
        this.getRetention = getRetention;
        this.log = log;
    }

    /**
     * 触发一次清理（并发去重：进行中的清理直接复用同一 Promise）。
     * activeFile/activeMetadataFile 为当前会话正在写的文件，永不删除。
     */
    cleanup(activeFile?: string, activeMetadataFile?: string): Promise<void> {
        if (this.task) return this.task;
        this.task = this.runCleanup(activeFile, activeMetadataFile).finally(() => {
            this.task = undefined;
        });
        return this.task;
    }

    /** 遍历目录删除超期文件；单文件失败与目录不存在（ENOENT）均只记 debug 不上抛。 */
    private async runCleanup(activeFile?: string, activeMetadataFile?: string) {
        const dir = getInstallLogDir(this.cwd);
        try {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            const now = Date.now();
            await Promise.all(
                entries
                    .filter(
                        (entry) =>
                            entry.isFile() &&
                            (entry.name.endsWith(".log") || entry.name.endsWith(".log.json")),
                    )
                    .map(async (entry) => {
                        const path = resolve(dir, entry.name);
                        // 活跃会话的文件即便 mtime 超龄也保留（重装过程中正在写入）
                        if (path === activeFile || path === activeMetadataFile) return;
                        try {
                            const stat = await fsp.stat(path);
                            if (now - stat.mtimeMs <= this.getRetention()) return;
                            await fsp.rm(path, { force: true });
                        } catch (error) {
                            this.log.debug(
                                `failed to cleanup install log ${path}: ${error instanceof Error ? error.message : error}`,
                            );
                        }
                    }),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                this.log.debug(
                    `failed to cleanup install logs: ${error instanceof Error ? error.message : error}`,
                );
            }
        }
    }
}
