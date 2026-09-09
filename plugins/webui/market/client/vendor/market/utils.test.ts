// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// vendor 逻辑层（utils.ts）的纯函数回归测试。测试文件不进入 tsconfig.web
// 类型检查（见其 exclude），运行时由 bun test 覆盖。

import { describe, expect, test } from "bun:test";
import type {
	SearchObject,
	User,
} from "@koishi-ce/registry";
import {
	badges,
	categories,
	comparators,
	getFiltered,
	getSorted,
	getUsers,
	hasFilter,
	resolveCategory,
	validate,
	validateWord,
} from "./utils.ts";

function mockUser(username: string, email: string): User {
	return { username, email };
}

function mockPackage(
	name: string,
	overrides: Partial<SearchObject["package"]> = {},
): SearchObject["package"] {
	const alice = mockUser("alice", "alice@test.dev");
	return {
		name,
		keywords: [],
		maintainers: [alice],
		publisher: alice,
		...overrides,
	} as SearchObject["package"];
}

function mockSearch(
	overrides: Partial<SearchObject> = {},
): SearchObject {
	const base: SearchObject = {
		shortname: "fake",
		searchScore: 0,
		score: {} as SearchObject["score"],
		rating: 5,
		license: "MIT",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		package: mockPackage("koishi-plugin-fake"),
		manifest: {
			description: "a fake plugin",
			service: {
				required: [],
				optional: [],
				implements: [],
			},
			locales: [],
		},
	};
	return { ...base, ...overrides } as SearchObject;
}

describe("validateWord / hasFilter / resolveCategory", () => {
	test("普通词与已知操作符合法，未知操作符非法", () => {
		expect(validateWord("console")).toBe(true);
		expect(validateWord("is:installed")).toBe(true);
		expect(validateWord("sort:rating-desc")).toBe(true);
		expect(validateWord("unknown:foo")).toBe(false);
	});

	test("hasFilter 只认非修饰词", () => {
		expect(hasFilter([])).toBe(false);
		expect(
			hasFilter(["sort:rating", "show:hidden", "limit:10"]),
		).toBe(false);
		expect(hasFilter(["category:general"])).toBe(true);
	});

	test("resolveCategory 兜底 other", () => {
		expect(resolveCategory("adapter")).toBe("adapter");
		expect(resolveCategory("nonexistent")).toBe("other");
		expect(resolveCategory(undefined)).toBe("other");
	});
});

describe("validate", () => {
	test("is:installed / not:installed 走 config 回调", () => {
		const data = mockSearch();
		expect(validate(data, "is:installed")).toBe(false);
		expect(
			validate(data, "is:installed", {
				installed: (d) =>
					d.package.name === "koishi-plugin-fake",
			}),
		).toBe(true);
		expect(validate(data, "not:installed")).toBe(true);
	});

	test("is:verified 透传对象标志位", () => {
		expect(
			validate(
				mockSearch({ verified: true }),
				"is:verified",
			),
		).toBe(true);
		expect(
			validate(mockSearch(), "is:verified"),
		).toBeFalsy();
	});

	test("manifest 分支支持 category / using", () => {
		const data = mockSearch({
			category: "general",
			manifest: {
				description: "a fake plugin",
				service: {
					required: [],
					optional: ["console"],
					implements: ["installer"],
				},
				locales: ["zh-CN"],
			},
		});
		expect(validate(data, "category:general")).toBe(true);
		expect(validate(data, "category:adapter")).toBe(false);
		expect(validate(data, "using:console")).toBe(true);
		expect(validate(data, "using:server")).toBe(false);
	});

	test("普通词按短名相似度匹配", () => {
		expect(validate(mockSearch(), "fake")).toBe(true);
		expect(validate(mockSearch(), "完全不相关的词")).toBe(
			false,
		);
	});
});

describe("getSorted", () => {
	const market = [
		mockSearch({
			package: mockPackage("koishi-plugin-a"),
			rating: 3,
		}),
		mockSearch({
			package: mockPackage("koishi-plugin-b"),
			rating: 9,
		}),
		mockSearch({
			deprecated: true,
			package: mockPackage("koishi-plugin-c"),
			rating: 10,
		}),
	];

	test("默认过滤 deprecated，show:deprecated 放行", () => {
		expect(
			getSorted(market, []).map((d) => d.rating),
		).toEqual([9, 3]);
		expect(
			getSorted(market, ["show:deprecated"]).map(
				(d) => d.rating,
			),
		).toEqual([10, 9, 3]);
	});

	test("sort:rating 与 -asc 控制顺序", () => {
		expect(
			getSorted(market, ["sort:rating"]).map(
				(d) => d.rating,
			),
		).toEqual([9, 3]);
		expect(
			getSorted(market, ["sort:rating-asc"]).map(
				(d) => d.rating,
			),
		).toEqual([3, 9]);
	});

	test("默认比较器按搜索词相似度加权", () => {
		const [first] = getSorted(market, ["b"]) ?? [];
		expect(first?.rating).toBe(9);
	});
});

describe("getFiltered / getUsers", () => {
	test("多词取交集", () => {
		const market = [
			mockSearch({ category: "general" }),
			mockSearch({
				category: "adapter",
				package: mockPackage("koishi-plugin-other"),
			}),
		];
		expect(
			getFiltered(
				market,
				["category:general", "is:installed"],
				{
					installed: (d) => d.category === "general",
				},
			),
		).toHaveLength(1);
	});

	test("getUsers 贡献者含维护者时胜出，否则回退维护者", () => {
		const alice = mockUser("alice", "alice@test.dev");
		const bob = mockUser("bob", "bob@test.dev");
		// 贡献者包含维护者 alice：以贡献者并集为准
		const withContributors = mockSearch({
			package: mockPackage("koishi-plugin-fake", {
				contributors: [alice, bob],
			}),
		});
		expect(getUsers(withContributors)).toEqual([
			alice,
			bob,
		]);

		// 贡献者与维护者无交集：回退维护者（无 email 时原样透出）
		const stranger = mockUser("carol", "carol@test.dev");
		const noMatch = mockSearch({
			package: mockPackage("koishi-plugin-fake", {
				maintainers: [
					{ username: "carol", email: undefined } as User,
				],
				contributors: [stranger],
			}),
		});
		expect(getUsers(noMatch)).toEqual([
			{ email: undefined, name: "carol" },
		]);
	});
});

describe("vendor 面锁定", () => {
	test("badges / comparators / categories 与上游对齐", () => {
		expect(Object.keys(badges)).toEqual([
			"installed",
			"verified",
			"insecure",
			"preview",
			"portable",
			"newborn",
		]);
		expect(Object.keys(comparators)).toEqual([
			"default",
			"rating",
			"download",
			"created",
			"updated",
		]);
		expect(categories).toHaveLength(14);
	});
});
