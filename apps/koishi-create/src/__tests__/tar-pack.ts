// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 测试专用 .tgz fixture 构造器（ustar + 超长名 pax 兜底 + gzip）。
 *
 * 生产代码的远程模板解包已改走 giget（见 src/index.ts scaffoldRemote），
 * 这里只保留「打包」一侧供测试构造伪 registry 的 tarball 响应。tar
 * 归档格式稳定，此工具不随业务演进，故不再单独维护解析逻辑与单测
 * ——其正确性由 __tests__/run-remote.test.ts 的「打包 → giget 解包」
 * 端到端链路间接验证。
 */

import { gzipSync } from "node:zlib";

const BLOCK = 512;
const encoder = new TextEncoder();

/** 单条目（供 tarPack 构造归档） */
export interface TarEntry {
	/** 归档内路径（相对归档根；目录以 / 结尾） */
	path: string;
	/** 条目类型（默认 file） */
	type?: "file" | "dir" | "symlink" | "hardlink";
	/** 文件内容（file 类型） */
	data?: Uint8Array;
	/** 链接目标（symlink / hardlink 类型，归档内相对路径） */
	link?: string;
}

/** 构造单条 pax 记录（len 前缀自洽的数字迭代） */
function paxRecord(key: string, value: string): string {
	const body = `${key}=${value}\n`;
	let length = body.length + 2;
	for (;;) {
		const prefix = `${length} `;
		if (prefix.length + body.length === length)
			return `${prefix}${body}`;
		length = prefix.length + body.length;
	}
}

/** 收集条目父目录（含显式目录自身），保证目录条目先于引用内容出现 */
function collectDirs(
	entries: readonly TarEntry[],
): string[] {
	const dirs = new Set<string>();
	for (const entry of entries) {
		if (entry.type === "dir" || entry.path.endsWith("/")) {
			dirs.add(entry.path.replace(/\/+$/, ""));
			continue;
		}
		let parent = entry.path.slice(
			0,
			entry.path.lastIndexOf("/"),
		);
		while (parent) {
			dirs.add(parent);
			const index = parent.lastIndexOf("/");
			parent = index < 0 ? "" : parent.slice(0, index);
		}
	}
	return [...dirs];
}

/** 构造一个 512 字节的 ustar 头部 */
function createHeader(
	name: string,
	type: string,
	size: number,
	link = "",
): Uint8Array {
	const header = new Uint8Array(BLOCK);
	// name / linkname 由调用方保证经 pax 兜底（此处截断仅作占位）
	header.set(encoder.encode(name), 0);
	header.set(encoder.encode(link), 157);
	writeOctal(header, 100, 8, type === "5" ? 0o755 : 0o644); // mode
	writeOctal(header, 108, 8, 0); // uid
	writeOctal(header, 116, 8, 0); // gid
	writeOctal(header, 124, 12, size);
	writeOctal(header, 136, 12, 0); // mtime
	header[156] = type.charCodeAt(0) ?? 0;
	header.set(encoder.encode("ustar\0"), 257);
	header.set(encoder.encode("00"), 263);
	// 校验和：先以空格占位，再求和回填（八进制 6 位 + \0 + 空格）
	header.fill(0x20, 148, 156);
	const sum = header.reduce(
		(total, byte) => total + byte,
		0,
	);
	const checksum = `${sum.toString(8).padStart(6, "0")}\0 `;
	header.set(encoder.encode(checksum), 148);
	return header;
}

/**
 * 把八进制数字写入定长字段，采用 tar 标准布局：前导 ASCII '0' 填充 +
 * 数字 + 空格 + '\0' 结尾（对齐 GNU tar / node-tar 的 encSmallNumber）。
 * 数字必须全部落在字段首个 NUL 之前——部分实现按 `\0` 截断解析，若用
 * NUL 做前导填充（旧实现写法）会把字段整体读成 0。
 */
function writeOctal(
	block: Uint8Array,
	offset: number,
	length: number,
	value: number,
): void {
	const digits = value.toString(8);
	if (digits.length === length - 1) {
		// 数字恰好占满（无空格），直接写 NUL 结尾
		block.set(encoder.encode(digits), offset);
		block[offset + length - 1] = 0;
		return;
	}
	const before = length - digits.length - 2;
	block.fill(0x30, offset, offset + before); // 前导 '0'
	block.set(encoder.encode(digits), offset + before);
	block[offset + before + digits.length] = 0x20; // 数字与 NUL 间留空格
	block[offset + length - 1] = 0;
}

/** 追加内容块并按 512 补齐 */
function pushPadded(
	blocks: Uint8Array[],
	content: Uint8Array,
): void {
	blocks.push(content);
	const rest = content.length % BLOCK;
	if (rest) blocks.push(new Uint8Array(BLOCK - rest));
}

/** 追加一个数据条目：超长名（ustar 上限 100 字节）自动前置 pax 扩展头 */
function pushEntry(
	blocks: Uint8Array[],
	name: string,
	type: string,
	size: number,
	content: Uint8Array,
	link = "",
): void {
	const records: string[] = [];
	if (encoder.encode(name).length > 100) {
		records.push(paxRecord("path", name));
	}
	if (link && encoder.encode(link).length > 100) {
		records.push(paxRecord("linkpath", link));
	}
	if (records.length) {
		const body = encoder.encode(records.join(""));
		// pax 扩展头自身也须有非空 name（node-tar 校验「path is
		// required」，空名会把整条 x 头判为无效并导致后续流错位）；
		// PaxHeader/ 前缀与 node-tar pack 的命名约定一致
		blocks.push(
			createHeader(`PaxHeader/${name}`, "x", body.length),
		);
		pushPadded(blocks, body);
	}
	blocks.push(
		createHeader(name.slice(0, 100), type, size, link),
	);
	if (size) pushPadded(blocks, content);
}

/**
 * 把条目表打包成 .tgz 字节（ustar + pax 扩展 + gzip）。
 * 仅供测试构造 fixture；产物与真实 npm tarball 的结构一致。
 */
export async function tarPack(
	entries: readonly TarEntry[],
): Promise<Uint8Array> {
	const blocks: Uint8Array[] = [];
	for (const dir of collectDirs(entries)) {
		blocks.push(createHeader(`${dir}/`, "5", 0));
	}
	for (const entry of entries) {
		if (entry.type === "dir" || entry.path.endsWith("/"))
			continue;
		if (
			entry.type === "symlink" ||
			entry.type === "hardlink"
		) {
			const type = entry.type === "symlink" ? "2" : "1";
			pushEntry(
				blocks,
				entry.path,
				type,
				0,
				new Uint8Array(0),
				entry.link ?? "",
			);
		} else {
			const data = entry.data ?? new Uint8Array(0);
			pushEntry(blocks, entry.path, "0", data.length, data);
		}
	}
	blocks.push(new Uint8Array(BLOCK * 2)); // 归档结束标志（全零块）

	const total = blocks.reduce(
		(sum, block) => sum + block.length,
		0,
	);
	const raw = new Uint8Array(total);
	let cursor = 0;
	for (const block of blocks) {
		raw.set(block, cursor);
		cursor += block.length;
	}

	// gzip 压缩为 .tgz（与 npm registry 的 tarball 同构）
	return gzipSync(raw);
}
