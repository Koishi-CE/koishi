// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 忽略更新策略与预发布屏蔽的纯函数回归测试(不进 tsconfig.web 类型
// 检查,运行时由 bun test 覆盖)。

import { describe, expect, it } from "bun:test";
import {
	createIgnoreRule,
	hasUpdate,
	isPrerelease,
	isUpdateIgnored,
	resolveLatest,
} from "./ignore-policy.ts";

describe("isPrerelease / resolveLatest 预发布屏蔽", () => {
	it("识别预发布版本并容忍非法版本号", () => {
		expect(isPrerelease("1.0.0-beta.1")).toBe(true);
		expect(isPrerelease("2.0.0-rc.0")).toBe(true);
		expect(isPrerelease("1.0.0")).toBe(false);
		expect(isPrerelease("not-a-version")).toBe(false);
	});

	it("屏蔽时取首个稳定版,全为预发布则视为无更新", () => {
		const versions = ["2.1.0-beta.1", "2.0.0", "1.9.0"];
		expect(resolveLatest(versions, true)).toBe("2.0.0");
		expect(resolveLatest(versions, false)).toBe(
			"2.1.0-beta.1",
		);
		expect(
			resolveLatest(["3.0.0-alpha.1"], true),
		).toBeUndefined();
	});

	it("空版本序列返回 undefined", () => {
		expect(resolveLatest([], false)).toBeUndefined();
		expect(resolveLatest([], true)).toBeUndefined();
	});
});

describe("hasUpdate 版本比较", () => {
	it("semver 语义比较且不可解析时保守返回 false", () => {
		expect(hasUpdate("1.0.0", "1.2.0")).toBe(true);
		expect(hasUpdate("1.2.0", "1.2.0")).toBe(false);
		expect(hasUpdate("2.0.0", "1.2.0")).toBe(false);
		expect(hasUpdate(undefined, "1.2.0")).toBe(false);
		expect(hasUpdate("1.0.0", undefined)).toBe(false);
		expect(hasUpdate("garbage", "1.0.0")).toBe(false);
	});
});

describe("isUpdateIgnored 忽略规则判定", () => {
	it("无规则不压制", () => {
		expect(isUpdateIgnored(undefined, "2.0.0")).toBe(false);
	});

	it("限时窗口内压制、过期后放行", () => {
		const now = 1_000_000;
		expect(
			isUpdateIgnored({ until: now + 1000 }, "2.0.0", now),
		).toBe(true);
		expect(
			isUpdateIgnored({ until: now - 1 }, "2.0.0", now),
		).toBe(false);
	});

	it("限版本规则只压制不高于该版本的更新", () => {
		expect(
			isUpdateIgnored({ version: "2.0.0" }, "2.0.0"),
		).toBe(true);
		expect(
			isUpdateIgnored({ version: "2.0.0" }, "2.1.0"),
		).toBe(false);
		// latest 未知时保守压制
		expect(
			isUpdateIgnored({ version: "2.0.0" }, undefined),
		).toBe(true);
	});

	it("无 until 无 version 为永久忽略", () => {
		expect(isUpdateIgnored({}, "9.0.0")).toBe(true);
	});
});

describe("createIgnoreRule 预设构造", () => {
	it("限时预设按当前时间推算截止", () => {
		const now = 1_000_000;
		expect(
			createIgnoreRule("days7", undefined, now),
		).toEqual({ until: now + 7 * 86_400_000 });
		expect(
			createIgnoreRule("days30", undefined, now),
		).toEqual({ until: now + 30 * 86_400_000 });
	});

	it("version 预设记录目标版本,缺版本时退永久", () => {
		expect(createIgnoreRule("version", "2.0.0")).toEqual({
			version: "2.0.0",
		});
		expect(createIgnoreRule("version", undefined)).toEqual(
			{},
		);
		expect(createIgnoreRule("forever", "2.0.0")).toEqual(
			{},
		);
	});
});
