// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 分类状态机与 override 编解码的纯函数回归测试(不进 tsconfig.web
// 类型检查,运行时由 bun test 覆盖)。

import { describe, expect, it } from "bun:test";
import {
	classify,
	decodeOverrideEntry,
	encodeOverrideEntry,
	getAliasTarget,
	getShortName,
	type PendingChange,
} from "./dependency-helpers.ts";

describe("classify 分类状态机(优先级链)", () => {
	it("待应用变更最优先,压过一切状态", () => {
		const kind = classify(
			{ workspace: true },
			{ type: "set", version: "2.0.0" },
			false,
			false,
		);
		expect(kind).toBe("pending");
	});

	it("override 有而快照无的条目视为待安装,同样归 pending", () => {
		expect(
			classify(undefined, undefined, false, false),
		).toBe("pending");
	});

	it("workspace > invalid > error 的优先顺序", () => {
		// workspace 与 invalid 并存时 workspace 胜出
		expect(
			classify(
				{ workspace: true, invalid: true },
				undefined,
				false,
				false,
			),
		).toBe("local");
		// invalid 与 error 并存时 invalid 胜出
		expect(
			classify(
				{ invalid: true, error: "network" },
				undefined,
				false,
				false,
			),
		).toBe("invalid");
		expect(
			classify(
				{ error: "not-found" },
				undefined,
				false,
				false,
			),
		).toBe("error");
	});

	it("钉名别名归 alias,且压过 invalid 与 error", () => {
		expect(
			classify({ alias: true }, undefined, false, false),
		).toBe("alias");
		expect(
			classify(
				{ alias: true, invalid: true },
				undefined,
				false,
				false,
			),
		).toBe("alias");
		expect(
			classify(
				{ alias: true, error: "not-found" },
				undefined,
				false,
				false,
			),
		).toBe("alias");
	});

	it("忽略压制与无可更新都归 installed,可更新归 updatable", () => {
		const dep = { resolved: "1.0.0" };
		expect(classify(dep, undefined, true, true)).toBe(
			"installed",
		);
		expect(classify(dep, undefined, false, false)).toBe(
			"installed",
		);
		expect(classify(dep, undefined, false, true)).toBe(
			"updatable",
		);
	});

	it("元数据拉取中(fetching)归 installed 组", () => {
		expect(
			classify({ fetching: true }, undefined, false, false),
		).toBe("installed");
	});
});

describe("override 编解码(空串 = 移除的既有协议)", () => {
	it("解码:undefined 无变更,空串移除,非空固定版本", () => {
		expect(decodeOverrideEntry(undefined)).toBeUndefined();
		expect(decodeOverrideEntry("")).toEqual({
			type: "remove",
		});
		expect(decodeOverrideEntry("2.0.0")).toEqual({
			type: "set",
			version: "2.0.0",
		});
	});

	it("编码与解码互逆", () => {
		const cases: PendingChange[] = [
			{ type: "remove" },
			{ type: "set", version: "1.2.3" },
		];
		for (const change of cases) {
			expect(
				decodeOverrideEntry(encodeOverrideEntry(change)),
			).toEqual(change);
		}
		expect(encodeOverrideEntry(undefined)).toBeUndefined();
	});
});

describe("getShortName 短名化", () => {
	it("剥离三种组织形式的 plugin- 前缀", () => {
		expect(getShortName("koishi-plugin-echo")).toBe("echo");
		expect(getShortName("@koishijs/plugin-echo")).toBe(
			"echo",
		);
		expect(getShortName("@koishi-ce/plugin-echo")).toBe(
			"echo",
		);
	});

	it("非插件包名原样保留", () => {
		expect(getShortName("cordis")).toBe("cordis");
		expect(getShortName("@scope/pkg")).toBe("@scope/pkg");
	});
});

describe("getAliasTarget 别名目标解析", () => {
	it("剥出 scoped 与非 scoped 声明的真实包名", () => {
		expect(
			getAliasTarget("npm:@koishi-ce/koishi-shim@^4.18.11"),
		).toBe("@koishi-ce/koishi-shim");
		expect(getAliasTarget("npm:foo@^1.0.0")).toBe("foo");
	});

	it("无版本串与非别名请求的边界", () => {
		expect(
			getAliasTarget("npm:@koishi-ce/console-shim"),
		).toBe("@koishi-ce/console-shim");
		expect(getAliasTarget("^1.0.0")).toBeUndefined();
	});
});
