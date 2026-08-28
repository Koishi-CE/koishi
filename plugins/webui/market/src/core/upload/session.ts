/**
 * @file 本地 .tgz 分块上传会话存储(core/upload 域)。
 *
 * 模块职责:LocalPackageUploadStore 维护"start → append* → finish → commit"
 * 的完整上传生命周期:分片顺序写入临时 .part 文件、流式计算 sha256、
 * finish 时解包校验(inspectPackageArchive)、commit 时原子落位到 .yarn/local。
 *
 * 关键设计:
 * - 严格顺序分片(index 必须等于 nextIndex)防止乱序/重复写入错位;
 * - 会话 TTL 15 分钟(start 时顺带清理过期会话与孤儿 .part 文件);
 * - finish 幂等:已校验的会话重复 finish 直接复用校验结果;
 * - 校验失败即销毁会话,避免残留可被继续 commit 的半成品状态。
 *
 * 架构位置:core 领域层,由 node/installer(wire.ts 组装)与
 * core/install/sources/upload 消费;会话状态形状与会话级工具函数拆至
 * session-utils.ts;文件系统直接经 node:fs 访问(core 允许使用 node
 * 内置模块,禁止 koishi 运行时)。
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalBindingRequest, MAX_LOCAL_BINDING_PACK_SIZE } from "./local-binding.js";
import {
    formatUploadBytes,
    LOCAL_UPLOAD_CHUNK_SIZE,
    placeUploadArchive,
    sweepTemporaryUploads,
    validateUploadFilename,
} from "./session-io.js";
import {
    closeLocalUploadHandle,
    getLocalUploadSession,
    inspectValidatedLocalPackage,
    LOCAL_UPLOAD_TTL,
    type LocalUploadSession,
    prepareAppendChunk,
    removeLocalUploadSession,
    type ValidatedLocalPackage,
} from "./session-utils.js";
import type {
    LocalPackageUploadChunkRequest,
    LocalPackageUploadCommitResult,
    LocalPackageUploadFinishRequest,
    LocalPackageUploadProgress,
    LocalPackageUploadStartRequest,
    LocalPackageUploadStartResult,
} from "./types.js";

/** 本地 .tgz 分块上传会话：分片写入、解包校验、原子落位 .yarn/local。 */
export class LocalPackageUploadStore {
    /** 归档最终存放目录 <baseDir>/.yarn/local */
    private readonly root: string;
    /** 临时分片目录(root/.market-next-upload) */
    private readonly temporaryRoot: string;
    /** uploadId → 会话(内存态,重启即失效,.part 由 sweep 兜底清理) */
    private readonly sessions = new Map<string, LocalUploadSession>();
    /** 清理失败等非致命问题的告警通道 */
    private readonly warn: (message: string) => void;

    constructor(baseDir: string, warn: (message: string) => void) {
        this.root = resolve(baseDir, ".yarn", "local");
        this.temporaryRoot = resolve(this.root, ".market-next-upload");
        this.warn = warn;
    }

    /**
     * 开始一次上传:清理过期会话与孤儿文件后,校验文件名与大小,
     * 创建排他的 .part 文件("wx" 防意外覆盖)并返回分块约定。
     */
    async start(request: LocalPackageUploadStartRequest): Promise<LocalPackageUploadStartResult> {
        await this.pruneExpired();
        const filename = validateUploadFilename(request?.filename);
        const size = Number(request?.size);
        if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_LOCAL_BINDING_PACK_SIZE) {
            throw new Error(
                `本地插件归档大小必须在 1 B 到 ${formatUploadBytes(MAX_LOCAL_BINDING_PACK_SIZE)} 之间。`,
            );
        }

        await fsp.mkdir(this.temporaryRoot, { recursive: true });
        const uploadId = randomUUID();
        const path = resolve(this.temporaryRoot, `${uploadId}.part`);
        // "wx" 排他创建:uploadId 是 UUID 理论上不冲突,此举是防御性兜底
        const handle = await open(path, "wx");
        this.sessions.set(uploadId, {
            id: uploadId,
            originalFilename: filename,
            path,
            size,
            received: 0,
            nextIndex: 0,
            touchedAt: Date.now(),
            handle,
            hash: createHash("sha256"),
        });
        return {
            uploadId,
            chunkSize: LOCAL_UPLOAD_CHUNK_SIZE,
            maxSize: MAX_LOCAL_BINDING_PACK_SIZE,
        };
    }

    /**
     * 追加一个分块:前置校验(序号顺序、块大小)通过后,按 received
     * 偏移写入并流式更新哈希。已 finish(校验完成)的会话拒绝继续写入。
     */
    async append(request: LocalPackageUploadChunkRequest): Promise<LocalPackageUploadProgress> {
        const session = getLocalUploadSession(this.sessions, request?.uploadId);
        const buffer = prepareAppendChunk(session, request);
        if (!session.handle) throw new Error("本地插件上传会话已经关闭。");

        const { bytesWritten } = await session.handle.write(
            buffer,
            0,
            buffer.length,
            session.received,
        );
        if (bytesWritten !== buffer.length) throw new Error("本地插件归档写入不完整，请重新上传。");
        session.hash.update(buffer);
        session.received += bytesWritten;
        session.nextIndex++;
        session.touchedAt = Date.now();
        return { received: session.received, size: session.size };
    }

    /**
     * 完成上传并做解包校验:字节数收齐后关闭句柄,计算最终哈希、
     * 解析归档 manifest、生成规范文件名并缓存为 validated(幂等:
     * 重复调用直接复用结果)。校验失败立即销毁会话,client 需重新上传。
     */
    async finish(
        request: LocalPackageUploadFinishRequest,
    ): Promise<ValidatedLocalPackage & { uploadId: string; filename: string; size: number }> {
        const session = getLocalUploadSession(this.sessions, request?.uploadId);
        if (session.validated) {
            // 幂等分支:client 网络重试等场景下重复 finish 不应报错
            return {
                ...session.validated,
                uploadId: session.id,
                filename: session.originalFilename,
                size: session.size,
            };
        }
        if (session.received !== session.size) {
            throw new Error(
                `本地插件归档尚未上传完成（${formatUploadBytes(session.received)} / ${formatUploadBytes(session.size)}）。`,
            );
        }
        await closeLocalUploadHandle(session);

        try {
            session.validated = await inspectValidatedLocalPackage(session);
            session.touchedAt = Date.now();
            return {
                ...session.validated,
                uploadId: session.id,
                filename: session.originalFilename,
                size: session.size,
            };
        } catch (error) {
            // 校验失败会话不可再用:清掉临时文件,避免残留"差一步就能落盘"的状态
            await removeLocalUploadSession(this.sessions, session);
            throw error;
        }
    }

    /**
     * 提交:把已校验的归档原子落位到 .yarn/local(同名同内容直接复用),
     * 销毁会话并返回可写入 package.json 的 file: 依赖串。
     */
    async commit(uploadId: string): Promise<LocalPackageUploadCommitResult> {
        const session = getLocalUploadSession(this.sessions, uploadId);
        if (!session.validated) throw new Error("请先完成本地插件归档校验。");
        await closeLocalUploadHandle(session);
        await fsp.mkdir(this.root, { recursive: true });
        await placeUploadArchive(
            this.root,
            session.path,
            session.validated.targetFilename,
            session.validated.hash,
        );
        this.sessions.delete(session.id);

        return {
            name: session.validated.manifest.name,
            version: session.validated.manifest.version,
            filename: session.validated.targetFilename,
            request: createLocalBindingRequest(session.validated.targetFilename),
            size: session.size,
            hash: session.validated.hash,
        };
    }

    /** 主动取消:会话不存在返回 false,存在则删除会话与临时文件。 */
    async cancel(uploadId: string) {
        const session = this.sessions.get(uploadId);
        if (!session) return false;
        await removeLocalUploadSession(this.sessions, session);
        return true;
    }

    /**
     * 清理过期会话(超过 TTL 无活动)与不属于任何活跃会话的孤儿 .part 文件。
     * 每次 start 都会顺带执行;单个清理失败仅告警,不阻断后续。
     */
    async pruneExpired(now = Date.now()) {
        const expired = [...this.sessions.values()].filter(
            (session) => now - session.touchedAt > LOCAL_UPLOAD_TTL,
        );
        await Promise.all(
            expired.map((session) =>
                removeLocalUploadSession(this.sessions, session).catch((error) => {
                    this.warn(
                        `failed to clean expired local upload ${session.id}: ${error instanceof Error ? error.message : error}`,
                    );
                }),
            ),
        );
        const activePaths = new Set([...this.sessions.values()].map((session) => session.path));
        await sweepTemporaryUploads(this.temporaryRoot, activePaths, now, LOCAL_UPLOAD_TTL);
    }

    /** 销毁全部会话(插件停用/进程退出时调用),单个失败仅告警。 */
    async dispose() {
        await Promise.all(
            [...this.sessions.values()].map((session) =>
                removeLocalUploadSession(this.sessions, session).catch((error) => {
                    this.warn(
                        `failed to dispose local upload ${session.id}: ${error instanceof Error ? error.message : error}`,
                    );
                }),
            ),
        );
    }
}
