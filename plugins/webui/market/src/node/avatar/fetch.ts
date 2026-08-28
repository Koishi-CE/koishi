/**
 * @file 头像网络抓取管线:URL 解析 -> SSRF 校验 -> HEAD 预检 -> 重定向 GET。
 *
 * 模块职责:
 * - fetchAvatarFromNetwork:抓取网络头像的统一入口,返回抓取结果与最终命中
 *   的 sourceUrl(供磁盘缓存回读时做"默认占位图"判定);任何校验不通过
 *   (协议非 http(s)、SSRF 命中、HEAD 拦截、响应异常)都返回 undefined
 *   而非抛错;
 * - 其余为管线内部步骤:URL 解析纯函数、HEAD 预检、手动重定向 GET、
 *   重定向目标解析(响应体的消费防线见 body.ts)。
 *
 * 关键设计:
 * - 重定向手动跟随(redirect: "manual"),每一跳都重新过 isBlockedAvatarTarget,
 *   防止"公网 URL 302 到内网地址"的绕过;跳数上限 AVATAR_MAX_REDIRECTS;
 * - HEAD 预检(1.2s 超时)先行拦截超大 Content-Length 与危险目标,GET
 *   本体再限 3s;HEAD 失败不阻断,降级为直接 GET。
 *
 * 架构位置:node 适配层 avatar 模块,由 avatar/index.ts 的 fetchAvatar 在
 * 内存/磁盘缓存未命中时调用。
 */
import type { Context, HTTP } from "@koishi-ce/koishi";
import {
    AVATAR_MAX_SIZE,
    type AvatarBodyStream,
    cancelAvatarBody,
    readAvatarResponse,
} from "./body.js";
import type { AvatarFetchResult } from "./memory-cache.js";
import { isBlockedAvatarTarget } from "./ssrf.js";

/** GET 超时:头像属于锦上添花,超时直接放弃。 */
const AVATAR_FETCH_TIMEOUT = 3000;
/** HEAD 预检超时:比 GET 更短,预检慢就降级跳过。 */
const AVATAR_HEAD_TIMEOUT = 1200;
/** 重定向上限:跟随 3 跳,防重定向环。 */
const AVATAR_MAX_REDIRECTS = 3;
/** Accept 头:优先现代图片格式,svg 降权,其余任意类型兜底。 */
const AVATAR_ACCEPT =
    "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.1";

/**
 * 网络抓取路径:解析并校验 URL -> SSRF 校验 -> HEAD 预检 -> 限流 GET ->
 * 消费响应。返回抓取结果与最终命中的 sourceUrl,任何一步不通过都返回
 * undefined(不抛错,调用方视作未命中)。
 */
export async function fetchAvatarFromNetwork(
    ctx: Context,
    rawUrl: string,
): Promise<{ result: AvatarFetchResult; sourceUrl: string } | undefined> {
    const url = parseAvatarHttpUrl(rawUrl);
    if (!url) return;
    if (await isBlockedAvatarTarget(url)) return;
    const checked = await checkAvatarHead(ctx, url);
    if (checked.blocked) return;
    const fetched = await fetchAvatarResponse(ctx, checked.url ?? url);
    if (!fetched) return;
    const result = await readAvatarResponse(fetched.response);
    if (!result) return;
    return { result, sourceUrl: fetched.sourceUrl };
}

/** 解析头像 URL:仅接受 http(s) 协议,解析失败或协议不符返回 undefined。 */
function parseAvatarHttpUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
    } catch {
        return undefined;
    }
}

/**
 * HEAD 预检:逐跳过 SSRF 校验后发 HEAD(手动重定向),提前拿到最终 URL、
 * 拦截超大 Content-Length 与危险目标。HEAD 抛错(如目标不支持)不阻断,
 * 返回当前 URL 降级为直接 GET。
 */
async function checkAvatarHead(ctx: Context, url: URL): Promise<{ url?: URL; blocked?: boolean }> {
    let current = url;
    for (let index = 0; index <= AVATAR_MAX_REDIRECTS; index++) {
        if (await isBlockedAvatarTarget(current)) return { blocked: true };
        try {
            const head = await ctx.http("HEAD", current.toString(), {
                timeout: AVATAR_HEAD_TIMEOUT,
                redirect: "manual",
                validateStatus: (status) => status >= 200 && status < 600,
                headers: { accept: AVATAR_ACCEPT },
            });
            if (isAvatarRedirect(head.status)) {
                const next = await resolveAvatarRedirect(current, head.headers.get("location"));
                if (!next) return { blocked: true };
                current = next;
                continue;
            }
            const headLength = Number(head.headers.get("content-length"));
            if (Number.isFinite(headLength) && headLength > AVATAR_MAX_SIZE)
                return { blocked: true };
            return { url: current };
        } catch (error) {
            ctx.logger("market").debug(
                `avatar HEAD skipped: url=${current}, error=${error instanceof Error ? error.message : error}`,
            );
            return { url: current };
        }
    }
    return { blocked: true };
}

/**
 * 发起 GET(手动重定向):每一跳先过 SSRF 校验,3xx 则取消当前流、解析
 * Location 后继续下一跳;非 3xx 返回响应与最终命中的 sourceUrl。全部
 * 校验通过前的返回都交由调用方判定 body。
 */
async function fetchAvatarResponse(
    ctx: Context,
    url: URL,
): Promise<{ response: HTTP.Response<AvatarBodyStream>; sourceUrl: string } | undefined> {
    let current = url;
    for (let index = 0; index <= AVATAR_MAX_REDIRECTS; index++) {
        if (await isBlockedAvatarTarget(current)) return;
        const response = await ctx.http(current.toString(), {
            timeout: AVATAR_FETCH_TIMEOUT,
            responseType: "stream",
            redirect: "manual",
            validateStatus: (status) => status >= 200 && status < 600,
            headers: { accept: AVATAR_ACCEPT },
        });
        if (!isAvatarRedirect(response.status)) return { response, sourceUrl: current.toString() };
        await cancelAvatarBody(response.data);
        const next = await resolveAvatarRedirect(current, response.headers.get("location"));
        if (!next) return;
        current = next;
    }
    return undefined;
}

/** 是否为需要手动跟随的 3xx 重定向状态码。 */
function isAvatarRedirect(status: number) {
    return status >= 300 && status < 400;
}

/**
 * 解析重定向目标:Location 相对 base 解析,协议限定 http(s),并立即对
 * 新目标做 SSRF 校验。任一不满足返回 undefined(调用方视为终止)。
 */
async function resolveAvatarRedirect(base: URL, location: string | null) {
    if (!location) return;
    let next: URL;
    try {
        next = new URL(location, base);
    } catch {
        return;
    }
    if (!["http:", "https:"].includes(next.protocol)) return;
    if (await isBlockedAvatarTarget(next)) return;
    return next;
}
