// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import {
	PLAIN_TEXT,
	resolveLanguage,
} from "./languages.ts";

/** 取解析出的状态栏显示名（未命中返回 PLAIN_TEXT，与编辑器回退一致）。 */
function labelOf(filename: string): string {
	return resolveLanguage(filename)?.label ?? PLAIN_TEXT;
}

describe("编辑器语言解析（按文件名）", () => {
	it("按扩展名命中对应语言", () => {
		expect(labelOf("koishi.yml")).toBe("YAML");
		expect(labelOf("package.json")).toBe("JSON");
		expect(labelOf("index.ts")).toBe("TypeScript");
		expect(labelOf("app.vue")).toBe("Vue");
		expect(labelOf("init.sql")).toBe("SQL");
		expect(labelOf("styles.scss")).toBe("SCSS");
		expect(labelOf("docs.md")).toBe("Markdown");
		expect(labelOf("bot.sh")).toBe("Shell");
		expect(labelOf("Cargo.toml")).toBe("TOML");
	});

	it("JS / TS 四类语法各自独立（tsx 与 ts 不可混用）", () => {
		expect(labelOf("a.js")).toBe("JavaScript");
		expect(labelOf("a.jsx")).toBe("JSX");
		expect(labelOf("a.ts")).toBe("TypeScript");
		expect(labelOf("a.tsx")).toBe("TSX");
		// .ts 与 .tsx 必须是两项不同的规格：前者不能开 jsx（泛型会被当标签），
		// 后者必须开 jsx。若哪天被合并成一项，这里会失败
		expect(resolveLanguage("a.ts")).not.toBe(
			resolveLanguage("a.tsx"),
		);
	});

	it("大小写不敏感", () => {
		expect(labelOf("README.MD")).toBe("Markdown");
		expect(labelOf("DOCKERFILE")).toBe("Dockerfile");
	});

	it("只取 basename，两种路径分隔符都能处理", () => {
		expect(labelOf("sub/dir/file.sql")).toBe("SQL");
		// win32 相对路径形态（explorer 的 filename 即此形态）
		expect(labelOf("sub\\dir\\file.sql")).toBe("SQL");
		// 目录名里带点不影响扩展名判定
		expect(labelOf("v1.2/notes.md")).toBe("Markdown");
	});

	it("无扩展名的固定文件名", () => {
		expect(labelOf("Dockerfile")).toBe("Dockerfile");
		// 带前缀的变体走扩展名匹配
		expect(labelOf("api.dockerfile")).toBe("Dockerfile");
	});

	it("点开头的隐藏文件整串视为扩展名", () => {
		expect(labelOf(".env")).toBe("INI");
		expect(labelOf("sub/.env")).toBe("INI");
	});

	it("未收录的类型回退纯文本", () => {
		expect(labelOf("data.xyz")).toBe(PLAIN_TEXT);
		expect(labelOf(".gitignore")).toBe(PLAIN_TEXT);
		expect(labelOf("LICENSE")).toBe(PLAIN_TEXT);
		expect(resolveLanguage("no-extension")).toBeUndefined();
	});

	it("后端语言不在支持范围（Koishi 生态为纯 TS/JS）", () => {
		for (const name of [
			"main.py",
			"Main.java",
			"main.go",
			"main.rs",
			"index.php",
			"main.cpp",
			"main.c",
			"main.h",
		])
			expect(labelOf(name)).toBe(PLAIN_TEXT);
	});
});
