// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 逻辑层测试共享的 registry 数据桩（不匹配 *.test.*，不作为用例收集）。

import type {
	SearchObject,
	User,
} from "@koishi-ce/registry";

export function mockUser(
	username: string,
	email: string,
): User {
	return { username, email };
}

export function mockPackage(
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

export function mockSearch(
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
