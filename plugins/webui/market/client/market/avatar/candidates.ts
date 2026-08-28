/**
 * @file 用户头像的候选链生成(market/avatar 域)。
 *
 * 为每个条目作者生成有序的头像候选列表:显式 avatar 字段 → 个人主页
 * url(仅图片后缀)→ 各 gravatar 镜像(含用户自配的 cravatar 等国内源)
 * → npm 官方头像代理。全模块纯函数,可独立单测。
 *
 * gravatar URL 带 d=404:头像不存在时返回 404 而非默认占位图,这样
 * <img> 的 error 事件才能触发回退到下一候选。
 */

import type { User } from "@koishi-ce/registry";
import { md5 } from "@noble/hashes/legacy.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { getUserKey } from "../users";

/** 字符串 → md5 十六进制(gravatar 哈希与缓存 key 都用它)。 */
function md5Hex(input: string) {
	return bytesToHex(md5(utf8ToBytes(input)));
}

/** 单个头像候选:url 为实际地址,source 标识来源,cacheKey 对应缓存条目。 */
export interface AvatarCandidate {
	url: string;
	source: string;
	cacheKey: string;
}

/** 是否合法的 http(s) 绝对地址。 */
function isHttpUrl(value?: string) {
	if (!value) return false;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** 是否以图片扩展名结尾(忽略 query/hash)。 */
function isImageUrl(value?: string) {
	return !!value && /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(value);
}

/**
 * 把用户配置的 gravatar 地址归一成 API base:
 * 仅接受 http(s);去掉尾斜杠与多余的 /avatar 路径段。
 */
function normalizeHttpBase(value?: string) {
	if (!value) return "";
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "";
		const path = url.pathname === "/" ? "" : url.pathname;
		return `${url.origin}${path}`.replace(/\/+$/, "").replace(/\/avatar$/i, "");
	} catch {
		return "";
	}
}

/**
 * gravatar base 列表:用户自配源最优先(通常是 cravatar 等可达镜像),
 * 之后是内置镜像与官方源;去重保序。
 */
function getGravatarBases(gravatar?: string) {
	const bases = [
		normalizeHttpBase(gravatar),
		"https://cravatar.cn",
		"https://www.cravatar.cn",
		"https://s.gravatar.com",
		"https://www.gravatar.com",
		"https://gravatar.com",
	].filter(Boolean) as string[];
	return bases.filter((base, index) => bases.indexOf(base) === index);
}

/** 字符串 → base64url(无填充),用于 npm 头像代理的编码参数。 */
function toBase64Url(value: string) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

/** gravatar 身份哈希:邮箱 trim + 小写后的 md5;无邮箱返回空串。 */
function getEmailHash(user: User) {
	if (!user.email) return "";
	return md5Hex(user.email.trim().toLowerCase());
}

/** 显式 URL 类候选的缓存 key:对归一化后的 URL 取 md5。仅供本域子模块共享。 */
export function createAvatarUrlCacheKey(url: string) {
	return `url:${md5Hex(normalizeAvatarUrl(url))}`;
}

/** URL 归一化(补全协议相对地址等),失败原样返回。仅供本域子模块共享。 */
export function normalizeAvatarUrl(url: string) {
	try {
		return new URL(url).toString();
	} catch {
		return url;
	}
}

/**
 * 生成各 gravatar base 下的头像 URL。d=404 让"无头像"返回 404,
 * 从而触发 <img> onerror 进入下一候选,而不是显示陌生人占位图。
 */
function createGravatarUrls(hash: string, gravatar?: string) {
	if (!hash) return [];
	const urls: string[] = [];
	for (const base of getGravatarBases(gravatar)) {
		urls.push(`${base}/avatar/${hash}.png?d=404`);
	}
	return urls;
}

/** npm 官方头像代理地址(把 s.gravatar.com 的请求包进 npmjs.com,借其缓存)。 */
function createNpmAvatarUrl(hash: string) {
	const upstream = `https://s.gravatar.com/avatar/${hash}.png?size=100&default=404`;
	return `https://www.npmjs.com/npm-avatar/${toBase64Url(upstream)}`;
}

/**
 * 组装某用户的完整候选链(顺序即回退顺序):
 * 1. manifest 里显式声明的 avatar(http(s) 或 data: URI);
 * 2. 个人主页 url,但仅当它本身是图片地址;
 * 3. 各 gravatar 镜像;
 * 4. npm 官方头像代理。
 * 最后按 url+cacheKey 去重。
 */
export function getUserAvatarCandidates(
	user: User,
	gravatar?: string,
): AvatarCandidate[] {
	const hash = getEmailHash(user);
	// gravatar 哈希候选共享的缓存 key;无邮箱时退化为 user key 的哈希
	const fallbackKey = hash
		? `gravatar:${hash}`
		: `user:${md5Hex(getUserKey(user) || JSON.stringify(user) || "anonymous")}`;
	const candidates: AvatarCandidate[] = [];
	const avatar = (user as User & { avatar?: string; url?: string }).avatar;
	if (
		avatar?.trim() &&
		(isHttpUrl(avatar) || avatar.trim().startsWith("data:"))
	) {
		const normalized = avatar.trim();
		candidates.push({
			url: normalized,
			source: "explicit",
			cacheKey: createAvatarUrlCacheKey(normalized),
		});
	}
	const url = (user as User & { avatar?: string; url?: string }).url;
	if (isHttpUrl(url) && isImageUrl(url))
		candidates.push({
			url: url!,
			source: "url",
			cacheKey: createAvatarUrlCacheKey(url!),
		});
	for (const gravatarUrl of createGravatarUrls(hash, gravatar)) {
		candidates.push({
			url: gravatarUrl,
			source: "gravatar",
			cacheKey: fallbackKey,
		});
	}
	if (hash) {
		candidates.push({
			url: createNpmAvatarUrl(hash),
			source: "npm-avatar",
			cacheKey: fallbackKey,
		});
	}
	return candidates.filter((candidate, index, array) => {
		return (
			array.findIndex(
				(item) =>
					item.url === candidate.url && item.cacheKey === candidate.cacheKey,
			) === index
		);
	});
}
