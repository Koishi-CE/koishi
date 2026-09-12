// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { expect, test } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getLocalRegistry,
	readNpmrcRegistry,
} from "../index.ts";

test("readNpmrcRegistry：提取首个 registry= 行，忽略注释与空行", () => {
	const dir = mkdtempSync(join(tmpdir(), "ckc-npmrc-"));
	const file = join(dir, ".npmrc");
	writeFileSync(
		file,
		"# 注释行\n; 另一种注释\n\nstrict-ssl=false\nregistry=https://registry.npmmirror.com/\r\n@scope:registry=https://example.com/\n",
	);
	expect(readNpmrcRegistry(file)).toBe(
		"https://registry.npmmirror.com/",
	);
	rmSync(dir, { recursive: true, force: true });
});

test("readNpmrcRegistry：文件不存在或未配置时返回 undefined 而不抛错", () => {
	expect(
		readNpmrcRegistry(
			join(tmpdir(), "ckc-不存在", ".npmrc"),
		),
	).toBeUndefined();
	const dir = mkdtempSync(join(tmpdir(), "ckc-npmrc-"));
	const file = join(dir, ".npmrc");
	writeFileSync(file, "strict-ssl=false\n");
	expect(readNpmrcRegistry(file)).toBeUndefined();
	rmSync(dir, { recursive: true, force: true });
});

test("getLocalRegistry：环境变量优先且校验协议，非法值跳过", () => {
	const key = "npm_config_registry";
	const isolated = mkdtempSync(
		join(tmpdir(), "ckc-npmrc-"),
	);
	Bun.env[key] = "https://registry.example.com/";
	expect(getLocalRegistry(isolated, isolated)).toBe(
		"https://registry.example.com/",
	);
	// 非 http(s) 的值视为未配置，继续走后续候选
	Bun.env[key] = "ftp://not-a-registry/";
	expect(
		getLocalRegistry(isolated, isolated),
	).toBeUndefined();
	delete Bun.env[key];
	rmSync(isolated, { recursive: true, force: true });
});

test("getLocalRegistry：项目 .npmrc 优先于用户级 .npmrc，均无配置时返回 undefined", () => {
	const key = "npm_config_registry";
	delete Bun.env[key];
	const dir = mkdtempSync(join(tmpdir(), "ckc-npmrc-"));
	const emptyHome = mkdtempSync(
		join(tmpdir(), "ckc-home-"),
	);
	writeFileSync(
		join(dir, ".npmrc"),
		"registry=http://localhost:4873/\n",
	);
	expect(getLocalRegistry(dir, emptyHome)).toBe(
		"http://localhost:4873/",
	);
	// 目录与用户级均无 .npmrc 时返回 undefined，主流程回落官方源
	expect(
		getLocalRegistry(emptyHome, emptyHome),
	).toBeUndefined();
	rmSync(dir, { recursive: true, force: true });
	rmSync(emptyHome, { recursive: true, force: true });
});
