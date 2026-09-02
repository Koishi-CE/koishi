// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 极简 tar 解包 / 打包工具（替代 npm tar 依赖，零第三方依赖）。
 *
 * gzip 解压走 node:zlib（Bun 兼容实现），归档按 ustar / pax 扩展格式
 * 解析后落盘；模板 tarball 体量小，整体解压后逐块消费。本模块是
 * apps/koishi-create 的内部实现（index.ts 相对导入，不进入 npm exports）；
 * tarPack 仅供测试构造 .tgz fixture 与覆盖解析分支使用。
 */

import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createGunzip, gzipSync } from "node:zlib";

/** ustar 块大小（头部与内容均按 512 字节对齐） */
const BLOCK = 512;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** 读取定长字段文本：\0 截断、去尾随空白 */
function readField(block: Uint8Array, offset: number, length: number): string {
	const text = decoder.decode(block.subarray(offset, offset + length));
	return text.split("\0")[0]?.trimEnd() ?? "";
}

/** 解析 tar 八进制数字字段（全零 / 空字段按 0 处理） */
function parseOctal(block: Uint8Array, offset: number, length: number): number {
	const text = decoder
		.decode(block.subarray(offset, offset + length))
		.replace(/[\0 ]/g, "");
	return text ? parseInt(text, 8) || 0 : 0;
}

/** 解析条目名与链接目标（仅 ustar 系归档含 prefix 拼接字段） */
function entryName(header: Uint8Array): { path: string; link: string } {
	const magic = decoder.decode(header.subarray(257, 263));
	const name = readField(header, 0, 100);
	const prefix =
		magic === "ustar\0" || magic === "ustar "
			? readField(header, 345, 155)
			: "";
	return {
		path: prefix ? `${prefix}/${name}` : name,
		link: readField(header, 157, 100),
	};
}

/**
 * 把归档内路径收窄为可安全落盘的相对路径：拒绝绝对路径与 .. 段，再按
 * strip 去掉前导目录段；无法安全落盘（含空结果）时返回 undefined。
 */
function safePath(name: string, strip: number): string | undefined {
	if (name.startsWith("/")) return undefined;
	const parts = name.split("/");
	if (parts.some((part) => part === "..")) return undefined;
	const rest = parts.filter((part) => part && part !== ".").slice(strip);
	return rest.length ? rest.join("/") : undefined;
}

/** 解析 pax 扩展头记录（"<len> <key>=<value>\n" 序列），返回键值表 */
function parsePax(content: Uint8Array): Record<string, string> {
	const records: Record<string, string> = {};
	let text = decoder.decode(content);
	while (text) {
		const space = text.indexOf(" ");
		if (space < 1) break;
		const length = parseInt(text.slice(0, space), 10);
		if (!length || length > text.length) break;
		const record = text.slice(space + 1, length - 1);
		const equal = record.indexOf("=");
		if (equal > 0) {
			records[record.slice(0, equal)] = record.slice(equal + 1);
		}
		text = text.slice(length);
	}
	return records;
}

/** 拉取完整 web 流并做 gzip 解压（模板 tarball 体量小，整块解析） */
async function gunzipAll(stream: NodeWebReadableStream): Promise<Uint8Array> {
	const source = Readable.fromWeb(stream).pipe(createGunzip());
	const chunks: Buffer[] = [];
	for await (const chunk of source) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

export interface UntarOptions {
	/** 落盘前去掉的归档内前导目录段数（npm 包根目录为 1） */
	strip?: number;
}

/**
 * 解包 gzip tar（.tgz）到 dest：按条目顺序 mkdir / 写文件 / 建链接。
 * 路径穿越条目（绝对路径、.. 段）与未知类型条目被安全跳过，不中断解包；
 * gzip 损坏或归档截断时抛出错误。
 */
export async function untar(
	stream: NodeWebReadableStream,
	dest: string,
	options: UntarOptions = {},
): Promise<void> {
	const raw = await gunzipAll(stream);
	const strip = options.strip ?? 0;
	mkdirSync(dest, { recursive: true });
	// pax 扩展头（x/g）对后续条目路径元数据的覆盖
	let offset = 0;
	let nameOverride: string | undefined;
	let linkOverride: string | undefined;

	while (offset + BLOCK <= raw.length) {
		const header = raw.subarray(offset, offset + BLOCK);
		offset += BLOCK;
		// tar 以若干全零块收尾，直接视为归档结束
		if (header.every((byte) => byte === 0)) break;
		const type = String.fromCharCode(header[156] ?? 0);
		const size = parseOctal(header, 124, 12);
		const padded = Math.ceil(size / BLOCK) * BLOCK;
		if (offset + padded > raw.length) {
			throw new Error("tar 归档意外截断（数据不完整）");
		}
		const content = padded
			? raw.subarray(offset, offset + size)
			: new Uint8Array(0);
		offset += padded;
		const names = entryName(header);
		const path = nameOverride ?? names.path;
		const link = linkOverride ?? names.link;
		nameOverride = undefined;
		linkOverride = undefined;

		// pax 扩展头条目本身不落盘，仅记录对后续条目的覆盖
		if (type === "x" || type === "g") {
			const records = parsePax(content);
			if (records["path"] !== undefined) nameOverride = records["path"];
			if (records["linkpath"] !== undefined) {
				linkOverride = records["linkpath"];
			}
			continue;
		}

		const target = safePath(path, strip);
		if (target === undefined) continue;
		if (type === "5") {
			mkdirSync(join(dest, target), { recursive: true });
		} else if (type === "2") {
			mkdirSync(dirname(join(dest, target)), { recursive: true });
			symlinkSync(link, join(dest, target));
		} else if (type === "1") {
			const source = safePath(link, strip);
			if (source === undefined) continue;
			copyFileSync(join(dest, source), join(dest, target));
		} else if (type === "0" || type === "\0" || type === "7") {
			const file = join(dest, target);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, content);
		}
	}
}

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
		if (prefix.length + body.length === length) return `${prefix}${body}`;
		length = prefix.length + body.length;
	}
}

/** 收集条目父目录（含显式目录自身），保证目录条目先于引用内容出现 */
function collectDirs(entries: readonly TarEntry[]): string[] {
	const dirs = new Set<string>();
	for (const entry of entries) {
		if (entry.type === "dir" || entry.path.endsWith("/")) {
			dirs.add(entry.path.replace(/\/+$/, ""));
			continue;
		}
		let parent = entry.path.slice(0, entry.path.lastIndexOf("/"));
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
	const sum = header.reduce((total, byte) => total + byte, 0);
	const checksum = `${sum.toString(8).padStart(6, "0")}\0 `;
	header.set(encoder.encode(checksum), 148);
	return header;
}

/** 把八进制数字右对齐写入定长字段（\0 结尾） */
function writeOctal(
	block: Uint8Array,
	offset: number,
	length: number,
	value: number,
): void {
	const digits = value.toString(8);
	const start = offset + length - 1 - digits.length;
	block.set(encoder.encode(digits), start);
	block[offset + length - 1] = 0;
}

/** 追加内容块并按 512 补齐 */
function pushPadded(blocks: Uint8Array[], content: Uint8Array): void {
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
		blocks.push(createHeader("", "x", body.length));
		pushPadded(blocks, body);
	}
	blocks.push(createHeader(name.slice(0, 100), type, size, link));
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
		if (entry.type === "dir" || entry.path.endsWith("/")) continue;
		if (entry.type === "symlink" || entry.type === "hardlink") {
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

	const total = blocks.reduce((sum, block) => sum + block.length, 0);
	const raw = new Uint8Array(total);
	let cursor = 0;
	for (const block of blocks) {
		raw.set(block, cursor);
		cursor += block.length;
	}

	// gzip 压缩为 .tgz（与 npm registry 的 tarball 同构）
	return gzipSync(raw);
}
