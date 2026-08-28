/**
 * @file 头像 GET 响应的消费防线:状态/类型/体积/占位图校验与限流读取。
 *
 * 模块职责:
 * - readAvatarResponse:校验并消费 GET 响应,状态 >= 400、非 image/*
 *   Content-Type、Content-Length 超限、或响应头标识为 gravatar 默认占位图
 *   的,取消流并返回 undefined;通过则限流读完 body,转 base64 返回;
 * - 其余为内部原语:拒绝路径统一收口的 cancelAndDiscard、逐 chunk 限流
 *   读取的 readLimitedAvatarBody、取消流的 cancelAvatarBody。
 *
 * 关键设计:
 * - 拒绝时主动 cancel 流(body 是 stream),避免连接悬挂;
 * - Content-Length 头可伪造,必须在流上实测兜底(超 AVATAR_MAX_SIZE
 *   立即 cancel 并放弃)。
 *
 * 架构位置:node 适配层 avatar 模块,由 fetch.ts 的网络抓取管线在拿到
 * GET 响应后调用。
 */
import type { HTTP } from "@koishi-ce/koishi";
import type { AvatarFetchResult } from "./memory-cache.js";
import { isAvatarDefaultResponse } from "./ssrf.js";

/** 头像体积上限:96KB,超过即取消下载(base64 后约 128KB,仍是可控负载)。 */
export const AVATAR_MAX_SIZE = 96 * 1024;

/** GET 响应的 body 流类型(koishi HTTP responseType: "stream")。 */
export type AvatarBodyStream = HTTP.ResponseTypes["stream"];

/**
 * 校验并消费 GET 响应:状态 >= 400、非 image/* Content-Type、Content-Length
 * 超限、或响应头标识为 gravatar 默认占位图的,取消流并返回 undefined;
 * 通过则限流读完 body,转 base64 返回。
 */
export async function readAvatarResponse(response: HTTP.Response<AvatarBodyStream>) {
    if (response.status >= 400) return cancelAndDiscard(response.data);
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    if (!type.startsWith("image/")) return cancelAndDiscard(response.data);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > AVATAR_MAX_SIZE) return cancelAndDiscard(response.data);
    if (isAvatarDefaultResponse(response.headers)) return cancelAndDiscard(response.data);
    const body = await readLimitedAvatarBody(response.data);
    if (!body?.byteLength) return;
    return { type, data: body.toString("base64") } satisfies AvatarFetchResult;
}

/** 拒绝路径统一收口:先 cancel 流再返回 undefined(不 cancel 会悬挂连接)。 */
async function cancelAndDiscard(stream: AvatarBodyStream) {
    await cancelAvatarBody(stream);
    return undefined;
}

/**
 * 限流读取 body:逐 chunk 累计字节数,超过 AVATAR_MAX_SIZE 立即 cancel
 * 并放弃(Content-Length 头可伪造,必须在流上实测兜底)。
 */
async function readLimitedAvatarBody(stream: AvatarBodyStream) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            size += value.byteLength;
            if (size > AVATAR_MAX_SIZE) {
                await reader.cancel().catch(() => {});
                return;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        size,
    );
}

/** 取消响应 body 流(拒绝路径统一调用,防连接悬挂;流可选/取消可选)。 */
export async function cancelAvatarBody(stream?: AvatarBodyStream) {
    await stream?.cancel?.().catch(() => {});
}
