// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectDependencyRequests,
	resolveLocalDependency,
} from "./snapshot.ts";
import type { Dependency } from "./types.ts";

/** 造一个临时宿主目录,并在 node_modules 内放置指定包的清单。 */
function setupHost(installed: Record<string, string> = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "deps-snapshot-"));
	for (const [name, version] of Object.entries(installed)) {
		const dir = join(cwd, "node_modules", name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ name, version }),
		);
	}
	process.chdir(cwd);
	return () => {
		process.chdir(join(cwd, ".."));
		rmSync(cwd, { recursive: true, force: true });
	};
}

describe("collectDependencyRequests", () => {
	it("以依赖声明为底建骨架并剥掉 ^/~ 前缀", () => {
		const result = collectDependencyRequests({
			"koishi-plugin-demo": "^1.2.3",
			cosmokit: "~1.8.0",
			pinned: "2.0.0",
		});
		expect(result["koishi-plugin-demo"]).toEqual({
			request: "1.2.3",
			fetching: true,
		});
		expect(result["cosmokit"]?.request).toBe("1.8.0");
		expect(result["pinned"]?.request).toBe("2.0.0");
		// 元数据全部置为待拉取
		expect(result["pinned"]?.fetching).toBe(true);
	});
});

describe("resolveLocalDependency", () => {
	it("补已装版本并保持待拉取形态", () => {
		const teardown = setupHost({ "pkg-a": "1.0.0" });
		try {
			const dep: Dependency = {
				request: "1.0.0",
				fetching: true,
			};
			resolveLocalDependency("pkg-a", dep, {
				previous: undefined,
			});
			expect(dep.resolved).toBe("1.0.0");
			expect(dep.workspace).toBe(false);
			expect(dep.invalid).toBeUndefined();
			// 已装且合法 semver:继续等待元数据刷新
			expect(dep.fetching).toBe(true);
		} finally {
			teardown();
		}
	});

	it("未安装的包 resolved 留空、不标 invalid", () => {
		const teardown = setupHost();
		try {
			const dep: Dependency = {
				request: "1.0.0",
				fetching: true,
			};
			resolveLocalDependency("pkg-missing", dep, {
				previous: undefined,
			});
			expect(dep.resolved).toBeUndefined();
			expect(dep.invalid).toBeUndefined();
			expect(dep.fetching).toBe(true);
		} finally {
			teardown();
		}
	});

	it("npm: 钉名别名标 alias、不判 invalid 且不参与拉取", () => {
		const teardown = setupHost({ koishi: "4.18.11" });
		try {
			const dep: Dependency = {
				request: "npm:@koishi-ce/koishi-shim@^4.18.11",
				fetching: true,
			};
			resolveLocalDependency("koishi", dep, {
				previous: undefined,
			});
			expect(dep.alias).toBe(true);
			expect(dep.resolved).toBe("4.18.11");
			expect(dep.invalid).toBeUndefined();
			// 钉名包无更新可言:不进入 registry 元数据拉取
			expect(dep.fetching).toBeUndefined();
		} finally {
			teardown();
		}
	});

	it("非精确 semver 的请求标记 invalid 且不参与拉取", () => {
		const teardown = setupHost();
		try {
			const dep: Dependency = {
				request: "file:./plugins/foo",
				fetching: true,
			};
			resolveLocalDependency("local-thing", dep, {
				previous: undefined,
			});
			expect(dep.invalid).toBe(true);
			expect(dep.fetching).toBeUndefined();
		} finally {
			teardown();
		}
	});

	it("上一轮 latest 与 404 负缓存被复用,网络错误不沿用", () => {
		const teardown = setupHost({ "pkg-a": "1.0.0" });
		try {
			const base = { request: "1.0.0", resolved: "1.0.0" };
			// latest 复用:fetching 随之消除
			const withLatest: Dependency = {
				...base,
				fetching: true,
				latest: "2.0.0",
			};
			resolveLocalDependency("pkg-a", withLatest, {
				previous: { ...base, latest: "2.0.0" },
			});
			expect(withLatest.latest).toBe("2.0.0");
			expect(withLatest.fetching).toBeUndefined();

			// not-found 复用(会话内不再重试)
			const notFound: Dependency = {
				...base,
				fetching: true,
			};
			resolveLocalDependency("pkg-a", notFound, {
				previous: { ...base, error: "not-found" },
			});
			expect(notFound.error).toBe("not-found");
			expect(notFound.fetching).toBeUndefined();

			// 网络错误不沿用:下一轮重新拉取
			const network: Dependency = {
				...base,
				fetching: true,
			};
			resolveLocalDependency("pkg-a", network, {
				previous: { ...base, error: "network" },
			});
			expect(network.error).toBeUndefined();
			expect(network.fetching).toBe(true);
		} finally {
			teardown();
		}
	});

	it("request 或 resolved 变化的条目不复用上一轮结果", () => {
		const teardown = setupHost({ "pkg-a": "1.5.0" });
		try {
			const dep: Dependency = {
				request: "1.5.0",
				fetching: true,
			};
			resolveLocalDependency("pkg-a", dep, {
				previous: {
					request: "1.0.0",
					resolved: "1.0.0",
					latest: "2.0.0",
					error: "not-found",
				},
			});
			expect(dep.latest).toBeUndefined();
			expect(dep.error).toBeUndefined();
			expect(dep.fetching).toBe(true);
		} finally {
			teardown();
		}
	});
});
