// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 逻辑层搜索/查询域的纯函数回归测试。测试文件不进入 tsconfig.web
// 类型检查（见其 exclude），运行时由 bun test 覆盖。

import { describe, expect, test } from "bun:test";
import type { User } from "@koishi-ce/registry";
import {
	getFiltered,
	getUsers,
	hasFilter,
	validate,
	validateWord,
} from "./search.ts";
import {
	mockPackage,
	mockSearch,
	mockUser,
} from "./test-utils.ts";

describe("validateWord / hasFilter", () => {
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

	test("未知操作符与未知日期方向放行，不参与相似度匹配", () => {
		expect(validate(mockSearch(), "unknown:foo")).toBe(
			true,
		);
		expect(validate(mockSearch(), "sort:rating")).toBe(
			true,
		);
		expect(validate(mockSearch(), "updated:foo")).toBe(
			true,
		);
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
					// registry 的 User 声明 email 必有，运行时可能缺失：模拟缺
					// email 的维护者形状（见 search.ts 的 MarketUser 头注释）
					{ username: "carol" } as User,
				],
				contributors: [stranger],
			}),
		});
		expect(getUsers(noMatch)).toEqual([
			{ email: undefined, name: "carol" },
		]);
	});
});
