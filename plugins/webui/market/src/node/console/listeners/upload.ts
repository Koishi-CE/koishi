/**
 * @file 本地 .tgz 上传类 console listener(upload 域)。
 *
 * 模块职责:把分块上传会话的五个 RPC(start/chunk/finish/commit/cancel)
 * 逐一转发给 installer 的 LocalPackageUploadService。全部是无编排的纯
 * 转发,因此走 registerContractListeners 表驱动注册。
 *
 * 架构位置:node 适配层 console/listeners,由 listeners/index.ts 聚合注册;
 * 会话状态与文件落盘都在 core 的 upload 模块。
 */
import type { Context } from "@koishi-ce/koishi";
import { registerContractListeners } from "./helpers.js";

/** 本地 .tgz 上传类 listener：分块上传会话的 start/chunk/finish/commit/cancel。 */
export function registerUploadListeners(ctx: Context) {
    registerContractListeners(ctx, {
        "market/local-package-upload-start": (request) =>
            ctx.installer.startLocalPackageUpload(request),
        "market/local-package-upload-chunk": (request) =>
            ctx.installer.appendLocalPackageUpload(request),
        "market/local-package-upload-finish": (request) =>
            ctx.installer.finishLocalPackageUpload(request),
        "market/local-package-upload-commit": (uploadId) =>
            ctx.installer.commitLocalPackageUpload(uploadId),
        "market/local-package-upload-cancel": (uploadId) =>
            ctx.installer.cancelLocalPackageUpload(uploadId),
    });
}
