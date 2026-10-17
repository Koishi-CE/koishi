// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 图标尺寸策略的构建级回归测试。
 *
 * 这里跑真实的 unplugin-icons 编译链（vite 编程式 build，不落盘），验证
 * 产物里的 svg 根元素不带固定宽高：`unsetIconSize` 必须在 iconify 的
 * configureSvgSize 写入尺寸之前生效，否则产出的 `width="1.2em"` 会把
 * 非方形图标锁在 1.2em 宽度上（侧栏图标变小）。同时反向锁定「delete
 * 无效」的成因——若哪天 unplugin-icons 调整了调用顺序，本用例会失败，
 * 提示可以简化实现。
 */

import { afterAll, describe, expect, it } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type PluginOption } from "vite";
import { iconsPlugin, unsetIconSize } from "./icons.ts";

const dir = mkdtempSync(join(tmpdir(), "koishi-icons-"));
afterAll(() =>
	rmSync(dir, { recursive: true, force: true }),
);

/** 用给定插件编译一个图标资产，返回生成的模块源码 */
async function compileIcon(
	plugins: PluginOption[],
	icon = "activity-market",
): Promise<string> {
	let seq = 0;
	const entry = join(dir, `entry-${++seq}.ts`);
	writeFileSync(
		entry,
		`import Icon from "~icons/k/${icon}";\nexport default Icon;\n`,
	);
	const result = await build({
		configFile: false,
		logLevel: "error",
		root: dir,
		build: {
			write: false,
			lib: {
				entry,
				formats: ["es"],
				fileName: () => "out.js",
			},
			rollupOptions: { external: ["vue"] },
			minify: false,
		},
		plugins,
	});
	// lib 模式恒返回 RollupOutput（watcher 只在 build.watch 下产生）
	const bundle = Array.isArray(result) ? result : [result];
	const chunk = bundle
		.flatMap((output) =>
			"output" in output ? output.output : [],
		)
		.find((item) => item.type === "chunk");
	return chunk?.type === "chunk" ? chunk.code : "";
}

describe("unsetIconSize", () => {
	it("把 width / height 置为 iconify 的取消关键字，其余属性不动", () => {
		const props: Record<string, string> = {
			class: "k-icon",
			viewBox: "0 0 512 512",
		};
		unsetIconSize(props);
		expect(props["width"]).toBe("unset");
		expect(props["height"]).toBe("unset");
		expect(props["viewBox"]).toBe("0 0 512 512");
		expect(props["class"]).toBe("k-icon");
	});
});

describe("iconsPlugin 的尺寸产物", () => {
	it("svg 根元素不带 width / height 属性", async () => {
		const code = await compileIcon([await iconsPlugin()]);
		expect(code).toContain("k-activity-market");
		expect(code).toContain("viewBox");
		expect(code).not.toContain("1.2em");
		expect(code).not.toMatch(/\bwidth:\s*"/);
		expect(code).not.toMatch(/\bheight:\s*"/);
	});

	it("保留说明中的反向事实：customizer 里 delete 会被后续尺寸写入覆盖", async () => {
		const Icons = (await import("unplugin-icons/vite"))
			.default;
		const { FileSystemIconLoader } = await import(
			"unplugin-icons/loaders"
		);
		const { createRequire } = await import("node:module");
		const { dirname, resolve } = await import("node:path");
		const manifestPath = createRequire(
			import.meta.url,
		).resolve("@koishi-ce/components/package.json");
		const iconsDir = resolve(
			dirname(manifestPath),
			"assets/icons",
		);
		const code = await compileIcon([
			Icons({
				compiler: "vue3",
				customCollections: {
					k: FileSystemIconLoader(iconsDir),
				},
				iconCustomizer(_collection, _icon, props) {
					delete props["width"];
					delete props["height"];
				},
			}),
		]);
		expect(code).toContain('width: "1.2em"');
		expect(code).toContain('height: "1.2em"');
	});
});
