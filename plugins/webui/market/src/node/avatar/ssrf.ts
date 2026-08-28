/**
 * @file 头像抓取的 SSRF 防线与 gravatar 默认占位图识别。
 *
 * 模块职责:
 * - isBlockedAvatarTarget:解析目标 hostname,命中黑名单、解析失败或指向
 *   私网/保留地址即拦截(白名单域名免 DNS 直接过);
 * - isAvatarCacheLikelyDefault / isAvatarDefaultResponse:识别 gravatar 系
 *   默认占位图,命中后磁盘缓存不落盘、响应直接丢弃,避免缓存"千人一面"。
 *
 * 关键设计:
 * - 域名必须先 DNS lookup 再对每个 A/AAAA 记录做私网判定:只看字面 hostname
 *   会被"域名解析到 127.0.0.1"绕过;
 * - 私网判定采用保守策略:IPv4/IPv6 解析失败一律视为私有(fail-closed),
 *   宁可拦错不可放过;
 * - 白名单(npmjs/gravatar/cravatar)是高频可信源,跳过 DNS 省一次查询。
 *
 * 架构位置:node 适配层 avatar 模块,被 avatar/index.ts(逐跳校验)与
 * disk-cache.ts(回读/清扫时剔除占位图)消费。
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import isPrivateIp from "private-ip";

/** 显式黑名单:localhost 变体(即便未来白名单调整也优先拦截)。 */
const AVATAR_BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);
/** 可信白名单:头像的主要来源站,免 DNS 解析直接放行。 */
const AVATAR_ALLOWED_HOSTS = new Set([
	"www.npmjs.com",
	"npmjs.com",
	"s.gravatar.com",
	"gravatar.com",
	"www.gravatar.com",
	"cravatar.cn",
	"www.cravatar.cn",
]);
/** gravatar ?d=/default= 支持的占位图模式名(default/mp/identicon 等)。 */
const AVATAR_DEFAULT_HINTS = new Set([
	"default",
	"mp",
	"identicon",
	"monsterid",
	"wavatar",
	"retro",
	"robohash",
	"blank",
]);

/** SSRF 防护：解析目标域名并做私网/被屏蔽主机判定。 */
export async function isBlockedAvatarTarget(url: URL) {
	const hostname = normalizeAvatarHostname(url.hostname);
	// 空 hostname(如 malformed URL)直接拦截
	if (!hostname || AVATAR_BLOCKED_HOSTS.has(hostname)) return true;
	if (isAllowedAvatarHost(hostname)) return false;
	const directIp = isIP(hostname);
	if (directIp) return isPrivateAddress(hostname, directIp);
	try {
		// 字面是域名时必须 lookup 后逐地址判定:域名可指向私网 IP
		const records = await lookup(hostname, { all: true, verbatim: false });
		if (!records.length) return true;
		return records.some((record) =>
			isPrivateAddress(record.address, record.family),
		);
	} catch {
		// DNS 解析失败按拦截处理(fail-closed)
		return true;
	}
}

/**
 * 补充说明:判定分两层——URL 显式带了占位模式参数(?d=mp 等)直接命中;
 * gravatar:* 键(即 gravatar 用户头像请求)在未显式要求 404 时,服务端
 * 可能回退占位图,也按"疑似占位"处理。
 */
/** 判断某个头像 URL 是否为 gravatar 默认占位图（命中后磁盘缓存不落盘）。 */
export function isAvatarCacheLikelyDefault(url: string, key: string) {
	try {
		const parsed = new URL(url);
		const hostname = normalizeAvatarHostname(parsed.hostname);
		const isGravatarHost = [
			"cravatar.cn",
			"www.cravatar.cn",
			"s.gravatar.com",
			"gravatar.com",
			"www.gravatar.com",
		].includes(hostname);
		if (!isGravatarHost) return false;
		if (getAvatarDefaultMode(parsed)) return true;
		if (!key.startsWith("gravatar:")) return false;
		const mode = (
			parsed.searchParams.get("d") ||
			parsed.searchParams.get("default") ||
			""
		)
			.trim()
			.toLowerCase();
		return mode !== "404";
	} catch {
		return false;
	}
}

/** 依据响应头 avatar-from 判定是否为 gravatar 默认占位图(default/mp)。 */
export function isAvatarDefaultResponse(headers: Headers) {
	const from = headers.get("avatar-from")?.trim().toLowerCase();
	return from === "default" || from === "mp";
}

/** hostname 是否在可信白名单内。 */
function isAllowedAvatarHost(hostname: string) {
	return AVATAR_ALLOWED_HOSTS.has(hostname);
}

/** 归一化 hostname:小写、剥 IPv6 方括号、去尾部点(FQDN 尾点)。 */
function normalizeAvatarHostname(hostname: string) {
	return hostname
		.toLowerCase()
		.replace(/^\[(.*)\]$/, "$1")
		.replace(/\.$/, "");
}

/** 取 URL 的 ?d= / ?default= 占位模式名:非空且在已知模式集合内才返回。 */
function getAvatarDefaultMode(url: URL) {
	const value =
		url.searchParams.get("d") || url.searchParams.get("default") || "";
	const normalized = value.trim().toLowerCase();
	return normalized && AVATAR_DEFAULT_HINTS.has(normalized) ? normalized : "";
}

/**
 * 私网/保留地址判定入口:按 family 分派,无法识别的 family 一律按私有处理。
 *
 * 主判定交给 private-ip 的 IANA 全段表(含 100.64/10 CGNAT、198.18/15、
 * TEST-NET 等手写判定容易遗漏的段);其未覆盖的两类形态在此补齐:
 * IPv4-mapped IPv6 整段拦截、IPv4 组播段(224-239)拦截。
 */
function isPrivateAddress(address: string, family = isIP(address)) {
	if (family !== 4 && family !== 6) return true;
	if (family === 6 && isIpv4Mapped(address)) return true;
	if (family === 4 && Number.parseInt(address.split(".")[0]!, 10) >= 224)
		return true;
	// private-ip 对无法解析的输入返回 undefined,按拦截处理(fail-closed)
	return isPrivateIp(address) !== false;
}

/**
 * IPv4-mapped IPv6(::ffff:0:0/96)判定:Node 会将其按内嵌 IPv4 建连,
 * 是 SSRF 常用混淆形态,整段一律拦截(无论内嵌公网还是私网 IP)。
 * 任意合法表示形式都以 ::ffff:(压缩)或 0:0:0:0:0:ffff:(展开)开头,
 * 两个前缀即可全覆盖,无需完整解析。
 */
function isIpv4Mapped(address: string) {
	const value = address.toLowerCase();
	return value.startsWith("::ffff:") || value.startsWith("0:0:0:0:0:ffff:");
}
