// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// upstream: koishijs/webui plugins/auth/src/index.ts L66-L70（randomId）、L79-L81（toHash）；PBKDF2_ROUNDS 与 verifyPassword 为本仓新增（上游无对应段）；上游为单文件，同步时以其整体 diff 对照本目录。
// 本仓分歧（E 类，勿回移）：上游监听器内联保留的旧版无盐 SHA-256 密码兼容校验已在本仓移除——CE 全新安装一律 pbkdf2$ 格式，旧格式不可达（2026-09-13 用户拍板）。

import {
	pbkdf2Sync,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

// 随机令牌的字符表（数字 + 大小写字母）
const letters =
	"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * 生成指定长度的随机令牌字符串。
 * @param length 令牌长度，默认 40
 * @returns 从字符表随机取字符拼接成的字符串
 */
export function randomId(length = 40) {
	// 登录令牌的安全敏感源：randomBytes（CSPRNG）+ 拒绝采样消除模偏差
	// （256 % 62 != 0），格式契约（字符表与长度）保持不变
	let out = "";
	while (out.length < length) {
		// 两倍余量覆盖拒绝采样损耗，极端涨落由外层 while 兜底补取
		for (const byte of randomBytes(length * 2)) {
			if (out.length >= length) break;
			if (byte >= 248) continue;
			out += letters[byte % letters.length] ?? "";
		}
	}
	return out;
}

/** PBKDF2-HMAC-SHA256 迭代次数（OWASP 2023 建议 600k；登录低频，开销可接受） */
const PBKDF2_ROUNDS = 600_000;

/** 新格式密码哈希：`pbkdf2$<rounds>$<salt-hex>$<dk-hex>`（加盐 + 慢哈希）。 */
export function toHash(password: string) {
	const salt = randomBytes(16);
	const dk = pbkdf2Sync(
		password,
		salt,
		PBKDF2_ROUNDS,
		32,
		"sha256",
	);
	return `pbkdf2$${PBKDF2_ROUNDS}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

/**
 * 校验明文密码与库中存储是否匹配。
 *
 * 仅接受 `pbkdf2$...` 格式：按存储的盐与迭代次数重派生，恒定时间比较；
 * 其余形态（含历史上游遗留的无盐 SHA-256 十六进制）一律不匹配。
 */
export function verifyPassword(
	password: string,
	stored: string,
): boolean {
	if (!stored.startsWith("pbkdf2$")) return false;
	const [, rounds, saltHex, dkHex] = stored.split("$");
	if (!rounds || !saltHex || !dkHex) return false;
	const expected = Buffer.from(dkHex, "hex");
	const actual = pbkdf2Sync(
		password,
		Buffer.from(saltHex, "hex"),
		Number(rounds),
		expected.length,
		"sha256",
	);
	// 长度已按 expected.length 派生，恒定时间比较不会抛错
	return timingSafeEqual(actual, expected);
}
