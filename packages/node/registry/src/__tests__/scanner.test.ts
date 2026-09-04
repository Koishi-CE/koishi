// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * registry 远程扫描器测试：isPlugin/isCompatible 静态判定、collect 分页
 * 搜索与条目过滤、process 单包分析（兼容版本筛选、清单填充、关键词
 * 清洗）及 analyze 阶段的钩子流转。HTTP 请求全部经注入的 mock request。
 */
import { describe, expect, it, mock } from "bun:test";
import Scanner from "../index.ts";
import type {
	Registry,
	RemotePackage,
	SearchObject,
	SearchResult,
} from "../types.ts";

/**
 * Scanner 构造器要求的泛型请求形状；桩函数返回具体类型，
 * 统一经该形状收窄注入（运行时仅按返回值消费）。
 */
type ScannerRequest = ConstructorParameters<
	typeof Scanner
>[0];

/** 生成搜索端点的单条结果（满足 SearchObject 的展示字段占位） */
function makeObject(
	name: string,
	date?: string,
): SearchObject {
	return {
		shortname: name,
		package: {
			name,
			version: "1.0.0",
			description: "",
			date: date ?? "2024-01-01T00:00:00.000Z",
			keywords: [],
			publisher: { email: "a@b.c" },
			maintainers: [],
		},
		searchScore: 1,
		score: {
			final: 1,
			detail: { quality: 1, popularity: 1, maintenance: 1 },
		},
		rating: 0,
		license: "MIT",
		manifest: {
			description: "",
			locales: [],
			service: {
				required: [],
				optional: [],
				implements: [],
			},
		},
		createdAt: "",
		updatedAt: "",
	};
}

/** 生成 registry 端点某个版本的完整清单 */
function remotePackage(
	version: string,
	meta: Partial<RemotePackage> = {},
): RemotePackage {
	return {
		name: "pkg",
		version,
		description: "",
		keywords: [],
		maintainers: [],
		license: "MIT",
		dist: {
			shasum: "",
			integrity: "",
			tarball: "",
			fileCount: 0,
			unpackedSize: 0,
		},
		peerDependencies: { koishi: "^4.0.0" },
		...meta,
	};
}

/** 生成 registry 端点的整包文档 */
function makeRegistry(
	versions: Record<string, RemotePackage>,
	time: Record<string, string>,
): Registry {
	return {
		name: "pkg",
		version: "1.0.0",
		description: "",
		versions,
		time,
		license: "MIT",
		readme: "",
		readmeFilename: "",
	};
}

describe("Scanner.isPlugin", () => {
	it("官方与社区两种组织形式均判定为插件", () => {
		expect(Scanner.isPlugin("@koishijs/plugin-foo")).toBe(
			true,
		);
		expect(Scanner.isPlugin("koishi-plugin-foo")).toBe(
			true,
		);
		expect(
			Scanner.isPlugin("@scope/koishi-plugin-foo"),
		).toBe(true);
	});

	it("非插件名与大写内层名判定为否", () => {
		expect(Scanner.isPlugin("foo")).toBe(false);
		expect(Scanner.isPlugin("@koishijs/plugin-Foo")).toBe(
			false,
		);
		expect(Scanner.isPlugin("@scope/plugin-foo")).toBe(
			false,
		);
		expect(Scanner.isPlugin("koishi-plugin-")).toBe(false);
	});
});

describe("Scanner.isCompatible", () => {
	it("peer 声明与目标范围有交集即兼容", () => {
		expect(
			Scanner.isCompatible("^4.0.0", {
				peerDependencies: { koishi: ">=4.0.0" },
			}),
		).toBe(true);
	});

	it("无交集、未声明 koishi peer 均不兼容", () => {
		expect(
			Scanner.isCompatible("^4.0.0", {
				peerDependencies: { koishi: "^3.0.0" },
			}),
		).toBe(false);
		expect(Scanner.isCompatible("^4.0.0", {})).toBe(false);
	});

	it("semver 解析失败按不兼容处理", () => {
		expect(
			Scanner.isCompatible("not a range!!", {
				peerDependencies: { koishi: "^4.0.0" },
			}),
		).toBe(false);
	});
});

describe("collect", () => {
	it("单页结果：过滤非插件与无日期条目、剔除 ignored 名单", async () => {
		const all = [
			makeObject("koishi-plugin-a"),
			makeObject("@koishijs/plugin-b"),
			makeObject("not-a-plugin"),
			makeObject("koishi-plugin-c"),
		];
		// 模拟 registry 缺陷：date 字段可能缺失（以 delete 模拟，读取结果同为 undefined）
		const noDate = makeObject("koishi-plugin-nodate");
		delete (noDate.package as { date?: string }).date;
		all.push(noDate);

		const urls: string[] = [];
		const request = async (url: string) => {
			urls.push(url);
			const size = Number(/size=(\d+)/.exec(url)?.[1]);
			const from = Number(/from=(\d+)/.exec(url)?.[1]);
			return {
				total: all.length,
				time: new Date().toUTCString(),
				objects: all.slice(from, from + size),
			} satisfies SearchResult;
		};

		const scanner = new Scanner(request as ScannerRequest);
		await scanner.collect({ ignored: ["koishi-plugin-c"] });
		expect(urls).toEqual([
			"/-/v1/search?text=koishi+plugin&size=250&from=0",
		]);
		expect(
			scanner.objects.map((o) => o.package.name),
		).toEqual(["koishi-plugin-a", "@koishijs/plugin-b"]);
		expect(scanner.total).toBe(2);
		expect(scanner.time).toBeTruthy();
	});

	it("多页结果：按 step-margin 推进并按包名去重", async () => {
		const all = ["a", "b", "c", "d", "e"].map((name) =>
			makeObject(`koishi-plugin-${name}`),
		);
		const urls: string[] = [];
		const request = async (url: string) => {
			urls.push(url);
			const size = Number(/size=(\d+)/.exec(url)?.[1]);
			const from = Number(/from=(\d+)/.exec(url)?.[1]);
			return {
				total: all.length,
				time: new Date().toUTCString(),
				objects: all.slice(from, from + size),
			} satisfies SearchResult;
		};

		const scanner = new Scanner(request as ScannerRequest);
		await scanner.collect({ step: 2, margin: 1 });
		// 每页起点回退 margin 条以重叠上一页，覆盖 total 后停止
		expect(urls).toEqual([
			"/-/v1/search?text=koishi+plugin&size=2&from=0",
			"/-/v1/search?text=koishi+plugin&size=2&from=1",
			"/-/v1/search?text=koishi+plugin&size=2&from=2",
			"/-/v1/search?text=koishi+plugin&size=2&from=3",
		]);
		expect(scanner.objects).toHaveLength(5);
	});

	it("搜索响应携带 version 时透传到扫描器", async () => {
		const request = async () =>
			({
				total: 0,
				time: new Date().toUTCString(),
				objects: [],
				version: 7,
			}) satisfies SearchResult;
		const scanner = new Scanner(request as ScannerRequest);
		await scanner.collect();
		expect(scanner.version).toBe(7);
	});
});

describe("process", () => {
	it("筛选兼容且未废弃的版本，填充清单与展示字段", async () => {
		const object = makeObject("koishi-plugin-demo");
		const registry = makeRegistry(
			{
				"0.9.0": remotePackage("0.9.0"),
				"1.0.0": remotePackage("1.0.0", {
					deprecated: "old release",
				}),
				"1.1.0": remotePackage("1.1.0", {
					peerDependencies: { koishi: "^3.0.0" },
				}),
				"1.2.0": remotePackage("1.2.0", {
					keywords: [
						"Helper",
						"koishi",
						"plugin",
						"demo",
						"market:hidden",
						"extra:kw",
					],
					author: { name: "author-name", email: "a@b.c" },
					koishi: {
						category: "tool",
						insecure: true,
						description: "demo plugin",
					},
				}),
			},
			{
				"0.9.0": "2023-01-01T00:00:00.000Z",
				"1.0.0": "2023-06-01T00:00:00.000Z",
				"1.1.0": "2023-09-01T00:00:00.000Z",
				"1.2.0": "2024-01-01T00:00:00.000Z",
			},
		);
		const request = async (url: string) => {
			expect(url).toBe("/koishi-plugin-demo");
			return registry;
		};
		const onRegistry = mock();

		const scanner = new Scanner(request as ScannerRequest);
		const versions = await scanner.process(
			object,
			"^4.0.0",
			onRegistry,
		);

		// 返回降序的兼容且未废弃版本（1.0.0 废弃、1.1.0 不兼容被剔除）
		expect(versions?.map((item) => item.version)).toEqual([
			"1.2.0",
			"0.9.0",
		]);
		// onRegistry 收到的兼容列表含废弃版本
		expect(onRegistry).toHaveBeenCalledWith(
			registry,
			expect.arrayContaining([
				expect.objectContaining({ version: "1.0.0" }),
			]),
		);

		expect(object.shortname).toBe("demo");
		expect(object.verified).toBe(false);
		// conclude 的 koishi.description 仅支持字典形态，字符串回退顶层
		// description（remotePackage 的顶层缺省为空串）
		expect(object.manifest.description).toBe("");
		expect(object.insecure).toBe(true);
		expect(object.category).toBe("tool");
		expect(object.createdAt).toBe(
			"2023-01-01T00:00:00.000Z",
		);
		expect(object.updatedAt).toBe(
			"2024-01-01T00:00:00.000Z",
		);
		// contributors 回退到 author
		expect(object.package.contributors).toEqual([
			{ name: "author-name", email: "a@b.c" },
		]);
		// 关键词清洗：小写化、剔除停用词（含子串匹配，如 chatbot 含
		// bot）/短名命中/含冒号的约定词
		expect(object.package.keywords).toEqual(["helper"]);
	});

	it("官方组织前缀的包标记 verified", async () => {
		const object = makeObject("@koishijs/plugin-official");
		const registry = makeRegistry(
			{ "1.0.0": remotePackage("1.0.0") },
			{ "1.0.0": "2024-01-01T00:00:00.000Z" },
		);
		const scanner = new Scanner(
			(async () => registry) as ScannerRequest,
		);
		await scanner.process(object, "^4.0.0", undefined);
		expect(object.shortname).toBe("official");
		expect(object.verified).toBe(true);
	});

	it("无兼容版本或全部废弃时返回 undefined", async () => {
		const scanner = new Scanner((async () =>
			makeRegistry(
				{
					"1.0.0": remotePackage("1.0.0", {
						peerDependencies: { koishi: "^3.0.0" },
					}),
				},
				{ "1.0.0": "2024-01-01T00:00:00.000Z" },
			)) as ScannerRequest);
		expect(
			await scanner.process(
				makeObject("koishi-plugin-x"),
				"^4.0.0",
				undefined,
			),
		).toBeUndefined();

		const scanner2 = new Scanner((async () =>
			makeRegistry(
				{
					"1.0.0": remotePackage("1.0.0", {
						deprecated: "gone",
					}),
				},
				{ "1.0.0": "2024-01-01T00:00:00.000Z" },
			)) as ScannerRequest);
		expect(
			await scanner2.process(
				makeObject("koishi-plugin-y"),
				"^4.0.0",
				undefined,
			),
		).toBeUndefined();
	});

	it("兼容版本缺发布时间时放弃填充并返回 undefined", async () => {
		const object = makeObject("koishi-plugin-notime");
		const registry = makeRegistry(
			{
				"0.9.0": remotePackage("0.9.0"),
				"1.0.0": remotePackage("1.0.0"),
			},
			// time 表缺失 0.9.0 的时间
			{ "1.0.0": "2024-01-01T00:00:00.000Z" },
		);
		const scanner = new Scanner(
			(async () => registry) as ScannerRequest,
		);
		expect(
			await scanner.process(object, "^4.0.0", undefined),
		).toBeUndefined();
		// 时间字段未被写入（createdAt 保持初值）
		expect(object.createdAt).toBe("");
	});

	it("最新版本无 author 时 contributors 回退为空数组", async () => {
		const object = makeObject("koishi-plugin-noauthor");
		const registry = makeRegistry(
			{ "1.0.0": remotePackage("1.0.0") },
			{ "1.0.0": "2024-01-01T00:00:00.000Z" },
		);
		const scanner = new Scanner(
			(async () => registry) as ScannerRequest,
		);
		await scanner.process(object, "^4.0.0", undefined);
		expect(object.package.contributors).toEqual([]);
	});
});

describe("analyze", () => {
	it("成功/跳过/失败钩子流转与进度计数", async () => {
		const good = makeObject("koishi-plugin-good");
		const empty = makeObject("koishi-plugin-empty");
		const broken = makeObject("koishi-plugin-broken");
		const preIgnored = makeObject(
			"koishi-plugin-pre-ignored",
		);
		preIgnored.ignored = true;

		const goodRegistry = makeRegistry(
			{ "1.0.0": remotePackage("1.0.0") },
			{ "1.0.0": "2024-01-01T00:00:00.000Z" },
		);
		const emptyRegistry = makeRegistry({}, {});
		const request = async (url: string) => {
			if (url === "/koishi-plugin-good")
				return goodRegistry;
			if (url === "/koishi-plugin-empty")
				return emptyRegistry;
			throw new Error("network down");
		};

		const before = mock();
		const onSuccess = mock();
		const onFailure = mock();
		const onSkipped = mock();
		const onRegistry = mock();
		const after = mock();

		const scanner = new Scanner(request as ScannerRequest);
		scanner.objects = [good, empty, broken, preIgnored];
		const result = await scanner.analyze({
			version: "^4.0.0",
			before,
			onSuccess,
			onFailure,
			onSkipped,
			onRegistry,
			after,
		});

		// 只有 good 产出了版本列表
		expect(result).toHaveLength(1);
		expect(result[0]?.map((item) => item.version)).toEqual([
			"1.0.0",
		]);
		expect(onSuccess).toHaveBeenCalledTimes(1);
		expect(onSuccess.mock.calls[0]?.[0]).toBe(good);

		// 无兼容版本 → onSkipped + ignored
		expect(
			onSkipped.mock.calls.map((call) => call[0]),
		).toEqual(["koishi-plugin-empty"]);
		expect(empty.ignored).toBe(true);

		// 请求抛错 → onFailure + ignored
		expect(onFailure.mock.calls[0]?.[0]).toBe(
			"koishi-plugin-broken",
		);
		expect(broken.ignored).toBe(true);

		// 预 ignored 的对象不进入处理（before/after 均不计）
		expect(
			before.mock.calls.map(
				(call) => call[0]?.package.name,
			),
		).toEqual([
			"koishi-plugin-good",
			"koishi-plugin-empty",
			"koishi-plugin-broken",
		]);
		expect(after).toHaveBeenCalledTimes(3);
		expect(scanner.progress).toBe(3);
		// onRegistry 在拉取到 registry 数据后总会调用：good 与 empty
		//（拉取成功但无兼容版本）各一次；broken 请求抛错不计
		expect(onRegistry).toHaveBeenCalledTimes(2);
	});
});
