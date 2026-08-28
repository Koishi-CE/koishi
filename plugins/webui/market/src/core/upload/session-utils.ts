/**
 * @file 上传会话的状态形状与会话级工具(core/upload 域)。
 *
 * 从 session.ts 拆出:会话/校验结果的数据结构、会话查找与销毁、追加分块
 * 前置校验以及 finish 解包校验等不依赖 Store 实例状态的逻辑,供
 * LocalPackageUploadStore 组合使用;只依赖 node 内置模块与同域工具。
 */
import type { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { PackageJson } from "@koishi-ce/registry";
import { decodeBase64Chunk, LOCAL_UPLOAD_CHUNK_SIZE } from "./session-io.js";
import {
	createCanonicalLocalPackageFilename,
	inspectPackageArchive,
} from "./tar.js";
import type { LocalPackageUploadChunkRequest } from "./types.js";

/** 会话空闲超时:超过 15 分钟无活动即清理(分块上传中断后不能永久占盘)。 */
export const LOCAL_UPLOAD_TTL = 15 * 60 * 1000;

/** finish/commit 校验通过后缓存的归档信息(重复 finish 幂等复用)。 */
export interface ValidatedLocalPackage {
	/** 归档内解析出的 package.json */
	manifest: PackageJson;
	/** 全量内容的 sha256(hex) */
	hash: string;
	/** 规范化的目标文件名(含 hash 后缀) */
	targetFilename: string;
}

/** 单个进行中的上传会话(临时 .part 文件 + 写入进度 + 流式哈希)。 */
export interface LocalUploadSession {
	id: string;
	/** client 声明的原始文件名(仅展示用,落盘用规范名) */
	originalFilename: string;
	/** 临时 .part 文件绝对路径 */
	path: string;
	/** 声明的总字节数 */
	size: number;
	/** 已写字节数(同时是下一块的写入偏移) */
	received: number;
	/** 下一个合法分块序号(强顺序约束) */
	nextIndex: number;
	/** 最后活动时间(TTL 判定) */
	touchedAt: number;
	/** 打开的文件句柄(finish 后关闭) */
	handle?: FileHandle | undefined;
	/** 流式 sha256(每块 update,finish 时 digest) */
	hash: ReturnType<typeof createHash>;
	/** finish 校验结果(未校验时 undefined) */
	validated?: ValidatedLocalPackage | undefined;
}

/** 取会话并做基本合法性校验(uploadId 须为 UUID 形态且会话仍存活)。 */
export function getLocalUploadSession(
	sessions: Map<string, LocalUploadSession>,
	uploadId: string,
) {
	if (typeof uploadId !== "string" || !/^[0-9a-f-]{36}$/i.test(uploadId)) {
		throw new Error("本地插件上传会话无效。");
	}
	const session = sessions.get(uploadId);
	if (!session) throw new Error("本地插件上传已过期，请重新选择文件。");
	return session;
}

/** 关闭会话文件句柄(置空后关闭,重复调用安全)。 */
export async function closeLocalUploadHandle(session: LocalUploadSession) {
	const handle = session.handle;
	session.handle = undefined;
	await handle?.close();
}

/** 彻底移除会话:出表 → 关句柄(失败忽略)→ 删临时文件。 */
export async function removeLocalUploadSession(
	sessions: Map<string, LocalUploadSession>,
	session: LocalUploadSession,
) {
	sessions.delete(session.id);
	await closeLocalUploadHandle(session).catch(() => {});
	await fsp.rm(session.path, { force: true });
}

/** 追加分块的前置校验:会话状态、序号顺序与块大小,通过后返回解码缓冲区。 */
export function prepareAppendChunk(
	session: LocalUploadSession,
	request: LocalPackageUploadChunkRequest,
) {
	if (session.validated) throw new Error("本地插件归档已经完成校验。");
	// 严格顺序:序号必须等于 nextIndex,杜绝乱序/重放导致的字节错位
	if (
		!Number.isSafeInteger(request?.index) ||
		request.index !== session.nextIndex
	) {
		throw new Error("本地插件上传分块顺序无效，请重新上传。");
	}
	const buffer = decodeBase64Chunk(request?.data);
	const remaining = session.size - session.received;
	if (
		!buffer.length ||
		buffer.length > LOCAL_UPLOAD_CHUNK_SIZE ||
		buffer.length > remaining
	) {
		throw new Error("本地插件上传分块大小无效，请重新上传。");
	}
	return buffer;
}

/** finish 校验核心:计算最终哈希、解包 manifest 并生成规范文件名。 */
export async function inspectValidatedLocalPackage(
	session: LocalUploadSession,
): Promise<ValidatedLocalPackage> {
	const hash = session.hash.digest("hex");
	const manifest = await inspectPackageArchive(session.path);
	const targetFilename = createCanonicalLocalPackageFilename(
		manifest.name,
		manifest.version,
		hash,
	);
	return { manifest, hash, targetFilename };
}
