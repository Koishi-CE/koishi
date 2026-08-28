/**
 * @file 本地上传包会话的类型与操作语义判定(core/upload 域)。
 *
 * 定义 client(node 层 RPC)与 LocalPackageUploadStore 之间分块上传协议的
 * 请求/响应结构(start → chunk* → finish → commit),以及依据当前已装版本
 * 与目标版本推导 install/upgrade/downgrade/replace 的纯函数。
 * 类型被 node/installer 与 core/install/sources/upload 消费。
 */
import { compare, valid } from "semver";

/** 本地归档相对当前依赖状态的操作语义(用于前端展示与安装确认)。 */
export type LocalPackageOperation = "install" | "upgrade" | "downgrade" | "replace";

/** 上传开始请求:client 声明原始文件名与总大小。 */
export interface LocalPackageUploadStartRequest {
    /** 原始文件名(须为 basename 形态的 .tgz) */
    filename: string;
    /** 归档总字节数(须为 1 B 到上限之间的安全整数) */
    size: number;
}

/** 上传开始结果:服务端分配的会话标识与分块约定。 */
export interface LocalPackageUploadStartResult {
    /** 会话标识(UUID),后续 chunk/finish/commit 都凭它寻址 */
    uploadId: string;
    /** 约定的单块大小(字节) */
    chunkSize: number;
    /** 允许的最大归档大小(字节) */
    maxSize: number;
}

/** 分块上传请求:严格按 index 顺序追加一段 base64 数据。 */
export interface LocalPackageUploadChunkRequest {
    /** 会话标识 */
    uploadId: string;
    /** 分块序号(必须等于会话当前 nextIndex,不允许乱序/跳跃) */
    index: number;
    /** 分块内容(base64 编码) */
    data: string;
}

/** 分块写入后的进度回报。 */
export interface LocalPackageUploadProgress {
    /** 已接收字节数 */
    received: number;
    /** 声明的总字节数 */
    size: number;
}

/** 完成上传请求:触发解包校验并返回预览信息。 */
export interface LocalPackageUploadFinishRequest {
    /** 会话标识 */
    uploadId: string;
}

/** 校验完成后的归档预览(client 据此展示并让用户确认操作类型)。 */
export interface LocalPackageUploadPreview {
    /** 会话标识 */
    uploadId: string;
    /** 原始文件名 */
    filename: string;
    /** 归档内 manifest 声明的包名 */
    name: string;
    /** 归档内 manifest 声明的版本 */
    version: string;
    /** manifest 描述(可缺省) */
    description?: string | undefined;
    /** 归档字节数 */
    size: number;
    /** 内容 sha256(hex) */
    hash: string;
    /** 归档 manifest 声明的安装脚本(lifecycle scripts,用于风险提示) */
    scripts: string[];
    /** package.json 中该依赖当前的范围串(未安装时缺省) */
    currentRequest?: string | undefined;
    /** 当前已装版本(未安装时缺省) */
    currentVersion?: string | undefined;
    /** 相对当前版本的操作语义 */
    operation: LocalPackageOperation;
}

/** 提交(落盘)结果:归档已写入 .yarn/local,request 可直接写入 package.json。 */
export interface LocalPackageUploadCommitResult {
    /** 包名 */
    name: string;
    /** 版本 */
    version: string;
    /** 规范化后的归档文件名(含 hash 后缀) */
    filename: string;
    /** 可写入 package.json 的 file: 协议依赖串 */
    request: string;
    /** 归档字节数 */
    size: number;
    /** 内容 sha256(hex) */
    hash: string;
}

/**
 * 依据当前已装版本与目标版本判断本地归档的操作语义。
 * 无现存请求视为全新 install;版本不可比较(非 semver)时退化为 replace,
 * 只有双方都是合法 semver 才细分 upgrade/downgrade/replace(相等亦 replace)。
 */
export function getLocalPackageOperation(
    currentRequest: string | undefined,
    currentVersion: string | undefined,
    targetVersion: string,
): LocalPackageOperation {
    if (!currentRequest) return "install";
    if (!currentVersion || !valid(currentVersion) || !valid(targetVersion)) return "replace";
    const result = compare(targetVersion, currentVersion);
    if (result > 0) return "upgrade";
    if (result < 0) return "downgrade";
    return "replace";
}
