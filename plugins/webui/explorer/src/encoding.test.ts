// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import {
	detectEncoding,
	HEAD_SIZE,
	readHead,
} from "./encoding.ts";

/** 构造指定长度的可重复字节序列。 */
function repeat(pattern: Buffer, times: number) {
	const buffer = Buffer.allocUnsafe(pattern.length * times);
	for (let i = 0; i < times; i++) {
		pattern.copy(buffer, i * pattern.length);
	}
	return buffer;
}

const gb18030 = Buffer.from([
	// "这是" 的 GBK/GB18030 双字节编码
	0xd5, 0xe2, 0xca, 0xc7,
]);
const shiftJis = Buffer.from([
	// "テスト" 的 Shift_JIS 双字节编码
	0x83, 0x65, 0x83, 0x58, 0x83, 0x67,
]);

describe("readHead", () => {
	it("短于阈值时返回原 buffer 本身", () => {
		const buffer = Buffer.from("hello world");
		expect(readHead(buffer)).toBe(buffer);
	});

	it("超长时返回不拷贝的头部视图", () => {
		const buffer = Buffer.alloc(HEAD_SIZE * 3, 0x61);
		const head = readHead(buffer);
		expect(head.length).toBe(HEAD_SIZE);
		// 视图共享底层内存：改原 buffer 可见
		buffer[0] = 0x62;
		expect(head[0]).toBe(0x62);
	});
});

describe("detectEncoding", () => {
	it("无 BOM 的合法 UTF-8 判为 UTF-8", () => {
		expect(detectEncoding(Buffer.from("hello world"))).toBe(
			"UTF-8",
		);
		expect(
			detectEncoding(
				repeat(Buffer.from("这是中文测试文本。"), 500),
			),
		).toBe("UTF-8");
	});

	it("UTF-8 BOM 优先于统计探测", () => {
		const buffer = Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf]),
			Buffer.from("这是中文", "utf8"),
		]);
		expect(detectEncoding(buffer)).toBe("UTF-8");
	});

	it("UTF-16LE BOM 判为 UTF-16LE", () => {
		const buffer = Buffer.concat([
			Buffer.from([0xff, 0xfe]),
			Buffer.from("中文测试内容", "utf16le"),
		]);
		expect(detectEncoding(buffer)).toBe("UTF-16LE");
	});

	it("UTF-16BE BOM 判为 UTF-16BE", () => {
		const buffer = Buffer.concat([
			Buffer.from([0xfe, 0xff, 0x4e, 0x2d]),
			Buffer.alloc(64, 0x00),
		]);
		expect(detectEncoding(buffer)).toBe("UTF-16BE");
	});

	it("UTF-32LE/BE BOM 判为 UTF-32 系列", () => {
		expect(
			detectEncoding(
				Buffer.concat([
					Buffer.from([0xff, 0xfe, 0x00, 0x00]),
					Buffer.alloc(64, 0x41),
				]),
			),
		).toBe("UTF-32LE");
		expect(
			detectEncoding(
				Buffer.concat([
					Buffer.from([0x00, 0x00, 0xfe, 0xff]),
					Buffer.alloc(64, 0x41),
				]),
			),
		).toBe("UTF-32BE");
	});

	it("GB18030 回落 chardet 统计探测", () => {
		expect(detectEncoding(repeat(gb18030, 400))).toBe(
			"GB18030",
		);
	});

	it("Shift_JIS 回落 chardet 统计探测", () => {
		expect(detectEncoding(repeat(shiftJis, 400))).toBe(
			"Shift_JIS",
		);
	});

	it("仅头部采样：尾部乱码不影响首选编码", () => {
		// 头部为 GB18030 文本，尾部追加非 UTF-8 噪声
		const buffer = Buffer.concat([
			repeat(gb18030, 2000),
			Buffer.alloc(1024 * 1024, 0xff),
		]);
		expect(detectEncoding(buffer)).toBe("GB18030");
	});

	it("超长文件不整体解码，尾部非法字节不触发统计探测", () => {
		// 头部 9 MB 全为合法 UTF-8（超出单次校验上限，只校验头部），
		// 尾部落在校验范围外的非法字节因此不影响判定
		const buffer = Buffer.concat([
			Buffer.alloc(9 * 1024 * 1024, 0x61),
			Buffer.from([0xff, 0xfe, 0xfd]),
		]);
		expect(detectEncoding(buffer)).toBe("UTF-8");
	});
});
