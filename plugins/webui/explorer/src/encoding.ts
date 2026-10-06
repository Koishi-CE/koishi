// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 文本编码探测工具（explorer/read 专用）。
 *
 * chardet 的统计式探测是 O(n) 且常数极大（实测约 350–400 µs/KB，
 * 8 MB 文件需 3.5 s），而实际打开的文件绝大多数是 UTF-8。这里改用
 * 三级快速路径：
 *
 * 1. BOM：文件头已显式声明编码，常数成本直接返回；
 * 2. 严格 UTF-8 解码：解码成功即证明整段是合法 UTF-8（TextDecoder 的
 *    fatal 模式遇非法序列抛错），无需统计即可确定编码；
 * 3. 回落 chardet：仅对确认不是 UTF-8 的文件做统计探测，且只取头部
 *    样本——样本量只影响置信度而非候选集（实测 4 KB 样本已给出与
 *    全量一致的首选编码，含 GB18030 / Shift_JIS / windows-1251）。
 *
 * 非 UTF-8 且无 BOM 的 UTF-16/32（罕见）由 chardet 负责：它对这类
 * 字节分布的首选编码即为 UTF-16/32 系列。
 */

import { analyse } from "chardet";

/** 严格 UTF-8 解码器：fatal 模式下遇到非法序列抛错。 */
const strictUtf8 = new TextDecoder("utf-8", {
	fatal: true,
});

/** 文件头读取长度：供 file-type 嗅探魔数与编码快速路径判定。 */
export const HEAD_SIZE = 4096;

/** 单次 UTF-8 校验的长度上限，超过则只校验头部（避免大文件全量解码）。 */
const VERIFY_LIMIT = 8 * 1024 * 1024;

/**
 * 取 buffer 的前 HEAD_SIZE 字节。
 *
 * 用 subarray 取视图而非拷贝：file-type 只读头部魔数，chardet 只读样本。
 * @returns 长度不超过 HEAD_SIZE 的视图（文件更短时即完整内容）
 */
export function readHead(buffer: Buffer): Buffer {
	return buffer.length <= HEAD_SIZE
		? buffer
		: buffer.subarray(0, HEAD_SIZE);
}

/** 从 BOM 判定编码；无 BOM 返回 undefined。 */
function fromBom(buffer: Buffer): string | undefined {
	if (
		buffer.length >= 3 &&
		buffer[0] === 0xef &&
		buffer[1] === 0xbb &&
		buffer[2] === 0xbf
	)
		return "UTF-8";
	if (
		buffer.length >= 4 &&
		buffer[0] === 0xff &&
		buffer[1] === 0xfe &&
		buffer[2] === 0x00 &&
		buffer[3] === 0x00
	)
		return "UTF-32LE";
	if (
		buffer.length >= 4 &&
		buffer[0] === 0x00 &&
		buffer[1] === 0x00 &&
		buffer[2] === 0xfe &&
		buffer[3] === 0xff
	)
		return "UTF-32BE";
	if (
		buffer.length >= 2 &&
		buffer[0] === 0xff &&
		buffer[1] === 0xfe
	)
		return "UTF-16LE";
	if (
		buffer.length >= 2 &&
		buffer[0] === 0xfe &&
		buffer[1] === 0xff
	)
		return "UTF-16BE";
	return undefined;
}

/** 整段（或超限时的头部）能否被严格 UTF-8 解码器接受。 */
function isUtf8(buffer: Buffer): boolean {
	try {
		strictUtf8.decode(
			buffer.length > VERIFY_LIMIT
				? buffer.subarray(0, VERIFY_LIMIT)
				: buffer,
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * 探测文本编码。
 *
 * 返回值语义与原先直接调用 chardet 的 detect 一致（"UTF-8" /
 * "GB18030" / "Shift_JIS" / "windows-1251" / "ASCII" 等），
 * 探测失败返回 undefined。
 */
export function detectEncoding(
	buffer: Buffer,
): string | undefined {
	const bom = fromBom(buffer);
	if (bom) return bom;
	// 纯 ASCII 也是合法 UTF-8，按 UTF-8 返回（语义上更准确）
	if (isUtf8(buffer)) return "UTF-8";

	const matches = analyse(readHead(buffer));
	return matches.length ? matches[0]?.name : undefined;
}
