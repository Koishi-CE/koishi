// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * registry 本地扫描测试：resolvePackageJson 的纯 fs 探测（含 Bun 父目录
 * 快照缓存场景模拟）、isResidentInCache 的驻留判定、LocalScanner 的目录
 * 扫描、同名包去重、失败上报与 loadPath 直读。
 */
import { afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getPluginShortname,
	isResidentInCache,
	LocalScanner,
	resolvePackageJson,
} from "../local.ts";

/** 模块加载时的进程工作目录（部分用例会 chdir，结束后回到这里） */
const rootDir = process.cwd();

/** 建立临时目录并在用后清理（清理前先离开该目录，避免 win32 句柄占用） */
async function withDir(fn: (dir: string) => Promise<void>) {
	const dir = await fs.mkdtemp(
		join(tmpdir(), "koishi-registry-local-"),
	);
	try {
		await fn(dir);
	} finally {
		// 有用例会 chdir 进临时目录，rm 前必须离开（win32 下删除占用中的 cwd 报 EBUSY）
		if (process.cwd() === dir) process.chdir(rootDir);
		await fs.rm(dir, { recursive: true, force: true });
	}
}

/** 在指定目录写入一个最小 package.json */
async function writePkg(
	dir: string,
	meta: Record<string, unknown> = {},
) {
	await fs.mkdir(dir, { recursive: true });
	await Bun.write(
		join(dir, "package.json"),
		JSON.stringify({
			description: "",
			keywords: [],
			...meta,
		}),
	);
}

describe("getPluginShortname", () => {
	it("剥离三种组织形式的插件前缀", () => {
		expect(getPluginShortname("koishi-plugin-foo")).toBe(
			"foo",
		);
		expect(getPluginShortname("@koishijs/plugin-foo")).toBe(
			"foo",
		);
		expect(
			getPluginShortname("@koishi-ce/plugin-foo"),
		).toBe("foo");
		// 其他组织下的社区包仅剥离 koishi-plugin- 部分
		expect(
			getPluginShortname("@scope/koishi-plugin-foo"),
		).toBe("@scope/foo");
		expect(getPluginShortname("plain")).toBe("plain");
	});
});

describe("resolvePackageJson", () => {
	it("直接命中 from 所在层 node_modules 的包", async () => {
		await withDir(async (dir) => {
			const pkgDir = join(
				dir,
				"node_modules",
				"resolve-fallback-demo",
			);
			await writePkg(pkgDir, {
				name: "resolve-fallback-demo",
			});
			expect(
				resolvePackageJson("resolve-fallback-demo", dir),
			).toBe(join(pkgDir, "package.json"));
		});
	});

	it("作用域包的子路径形态", async () => {
		await withDir(async (dir) => {
			const pkgDir = join(
				dir,
				"node_modules",
				"@scope",
				"scoped-demo",
			);
			await writePkg(pkgDir, {
				name: "@scope/scoped-demo",
			});
			expect(
				resolvePackageJson("@scope/scoped-demo", dir),
			).toBe(join(pkgDir, "package.json"));
		});
	});

	it("兜底：从起始目录逐级向上探测祖先 node_modules", async () => {
		await withDir(async (dir) => {
			const pkgDir = join(
				dir,
				"node_modules",
				"chain-probe-demo",
			);
			await writePkg(pkgDir, { name: "chain-probe-demo" });
			// 起始点在深层子目录，探测链应逐级向上直到 dir 命中
			expect(
				resolvePackageJson(
					"chain-probe-demo",
					join(dir, "a", "b", "c"),
				),
			).toBe(join(pkgDir, "package.json"));
		});
	});

	it("市场安装时序：装前探测零解析 API，落盘后同进程立即可读", async () => {
		await withDir(async (dir) => {
			// 预建 scope 目录（生产中 node_modules/@koishijs 恒存在——Bun
			// 父目录快照缓存的触发条件：解析失败时父目录已存在）
			await fs.mkdir(join(dir, "node_modules", "@scope"), {
				recursive: true,
			});
			// 市场装前探测：包未装，fs 探测落空即抛（全程不触碰解析 API）
			expect(() =>
				resolvePackageJson("@scope/late-install", dir),
			).toThrow(
				"Cannot resolve '@scope/late-install/package.json'",
			);

			const pkgDir = join(
				dir,
				"node_modules",
				"@scope",
				"late-install",
			);
			await writePkg(pkgDir, {
				name: "@scope/late-install",
				main: "index.js",
			});
			await Bun.write(
				join(pkgDir, "index.js"),
				"module.exports = 1",
			);
			// 探测未污染解析缓存：同进程内裸名形态的解析 API 直接成功
			// （旧实现经 require.resolve 主路径探测失败过一次后，此处与
			// 下面的裸名解析都会永久失败——生产 "failed to resolve" 根因）
			expect(
				resolvePackageJson("@scope/late-install", dir),
			).toBe(join(pkgDir, "package.json"));
			expect(
				Bun.resolveSync("@scope/late-install", dir),
			).toBe(join(pkgDir, "index.js"));
		});
	});

	it("全部探测落空时抛错", async () => {
		await withDir(async (dir) => {
			// 同步抛错：需以函数形式断言
			expect(() =>
				resolvePackageJson("definitely-missing-pkg", dir),
			).toThrow(
				"Cannot resolve 'definitely-missing-pkg/package.json'",
			);
		});
	});
});

describe("isResidentInCache", () => {
	afterEach(() => {
		process.chdir(rootDir);
	});

	it("包未驻留 require.cache 时为 false，require 入口后为 true", async () => {
		await withDir(async (dir) => {
			const pkgDir = join(
				dir,
				"node_modules",
				"resident-demo",
			);
			await writePkg(pkgDir, {
				name: "resident-demo",
				main: "index.js",
			});
			await Bun.write(
				join(pkgDir, "index.js"),
				"module.exports = 1",
			);
			// 驻留判定以进程工作目录为基准（与 market 调用方一致）
			process.chdir(dir);
			expect(isResidentInCache("resident-demo")).toBe(
				false,
			);
			require(join(pkgDir, "index.js"));
			expect(isResidentInCache("resident-demo")).toBe(true);
		});
	});

	it("包不存在时保守返回 true（宁可多重载不可漏判）", () => {
		expect(isResidentInCache("definitely-absent-pkg")).toBe(
			true,
		);
	});
});

describe("LocalScanner", () => {
	afterEach(() => {
		process.chdir(rootDir);
	});

	it("扫描目录内全部插件形态并产出 SearchObject", async () => {
		await withDir(async (dir) => {
			await writePkg(
				join(dir, "node_modules", "koishi-plugin-alpha"),
				{
					name: "koishi-plugin-alpha",
					version: "1.0.0",
					keywords: ["required:database"],
				},
			);
			await writePkg(
				join(
					dir,
					"node_modules",
					"@koishi-ce",
					"plugin-beta",
				),
				{
					name: "@koishi-ce/plugin-beta",
					version: "2.0.0",
				},
			);
			await writePkg(
				join(
					dir,
					"node_modules",
					"@third",
					"koishi-plugin-gamma",
				),
				{
					name: "@third/koishi-plugin-gamma",
					version: "3.0.0",
				},
			);
			// 非插件目录与无关作用域内层名不被收录
			await writePkg(join(dir, "node_modules", "lodash"), {
				name: "lodash",
			});
			await writePkg(
				join(dir, "node_modules", "@third", "plugin-delta"),
				{
					name: "@third/plugin-delta",
				},
			);

			// loadManifest 经 resolvePackageJson 兜底，基准为进程工作目录
			process.chdir(dir);
			const scanner = new LocalScanner(dir);
			await scanner.collect();

			const names = scanner.objects.map(
				(object) => object.package.name,
			);
			expect(names).toContain("koishi-plugin-alpha");
			expect(names).toContain("@koishi-ce/plugin-beta");
			expect(names).toContain("@third/koishi-plugin-gamma");
			expect(names).not.toContain("lodash");
			expect(names).not.toContain("@third/plugin-delta");

			const alpha = scanner.objects.find(
				(object) =>
					object.package.name === "koishi-plugin-alpha",
			)!;
			expect(alpha.shortname).toBe("alpha");
			// 经 node_modules 解析到的包不是 workspace 直连形态
			expect(alpha.workspace).toBe(false);
			expect(alpha.manifest.service.required).toEqual([
				"database",
			]);
			// package 只保留市场展示需要的四个字段（peer 字段原地补全）；
			// 裁剪后的运行时形状比声明类型窄，按 object 视图断言
			expect(alpha.package as object).toEqual({
				name: "koishi-plugin-alpha",
				version: "1.0.0",
				peerDependencies: {},
				peerDependenciesMeta: {},
			});
		});
	});

	it("从 baseDir 逐级向上扫描，同名包靠缓存去重只加载一次", async () => {
		await withDir(async (dir) => {
			// 坏包放在顶层 node_modules，baseDir 在深层：两层扫描都会遇到
			// 同名包，但缓存去重应保证只加载（失败上报）一次
			const badDir = join(
				dir,
				"node_modules",
				"koishi-plugin-bad",
			);
			await fs.mkdir(badDir, { recursive: true });
			await Bun.write(
				join(badDir, "package.json"),
				"{ broken json",
			);

			const errors: [unknown, string][] = [];
			class RecordingScanner extends LocalScanner {
				override onError(reason: unknown, name: string) {
					errors.push([reason, name]);
				}
			}
			const baseDir = join(dir, "deep", "leaf");
			await fs.mkdir(baseDir, { recursive: true });
			process.chdir(dir);
			const scanner = new RecordingScanner(baseDir);
			await scanner.collect();

			expect(errors).toHaveLength(1);
			expect(errors[0]![1]).toBe("koishi-plugin-bad");
		});
	});

	it("collect 复用已完成任务，forced 强制重扫", async () => {
		await withDir(async (dir) => {
			const badDir = join(
				dir,
				"node_modules",
				"koishi-plugin-flaky",
			);
			await fs.mkdir(badDir, { recursive: true });
			await Bun.write(
				join(badDir, "package.json"),
				"{ broken",
			);

			let count = 0;
			class CountingScanner extends LocalScanner {
				override onError() {
					count += 1;
				}
			}
			process.chdir(dir);
			const scanner = new CountingScanner(dir);
			await scanner.collect();
			expect(count).toBe(1);
			// 未 forced 的重复 collect 复用任务结果，不再扫描
			await scanner.collect();
			expect(count).toBe(1);
			// forced 丢弃缓存重新扫描
			await scanner.collect(true);
			expect(count).toBe(2);
		});
	});

	it("loadPath 直读目录、标记 workspace 形态并按目录缓存", async () => {
		await withDir(async (dir) => {
			await writePkg(join(dir, "my-plugin"), {
				name: "koishi-plugin-my",
				version: "1.0.0",
			});
			const errors: [unknown, string][] = [];
			class RecordingScanner extends LocalScanner {
				override onError(reason: unknown, name: string) {
					errors.push([reason, name]);
				}
			}
			const scanner = new RecordingScanner(dir);

			const object = await scanner.loadPath(
				join(dir, "my-plugin"),
			);
			expect(object?.workspace).toBe(true);
			expect(object?.shortname).toBe("my");
			expect(object?.package.name).toBe("koishi-plugin-my");
			// 同目录重复加载命中缓存，返回同一对象
			expect(
				await scanner.loadPath(join(dir, "my-plugin")),
			).toBe(object);

			// 目录不存在：onError 上报后返回 undefined
			expect(
				await scanner.loadPath(join(dir, "missing")),
			).toBeUndefined();
			expect(errors).toHaveLength(1);
			expect(errors[0]![1]).toBe(join(dir, "missing"));
		});
	});
});
