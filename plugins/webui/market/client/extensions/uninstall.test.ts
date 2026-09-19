// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 配置页「卸载插件」状态机纯函数的回归测试:暂存写入 / 撤销 / 按钮
// 形态流转,并与依赖页的 decodeOverrideEntry 联动验证两侧共用同一
// override 暂存区协议(不进 tsconfig.web 类型检查,运行时由 bun test 覆盖)。

import { describe, expect, it } from "bun:test";
import { decodeOverrideEntry } from "../dependencies/dependency-helpers.ts";
import {
	buildUninstallPayload,
	cancelRemoval,
	resolveButtonState,
	stageRemoval,
} from "./uninstall.ts";

describe("buildUninstallPayload 卸载载荷", () => {
	it("值为空串,即 override 协议的移除语义", () => {
		const payload = buildUninstallPayload(
			"@koishi-ce/plugin-echo",
		);
		expect(payload).toEqual({
			"@koishi-ce/plugin-echo": "",
		});
		expect(Object.keys(payload)).toEqual([
			"@koishi-ce/plugin-echo",
		]);
	});

	it("载荷经依赖页解码得到移除变更", () => {
		const payload = buildUninstallPayload(
			"koishi-plugin-foo",
		);
		expect(
			decodeOverrideEntry(payload["koishi-plugin-foo"]),
		).toEqual({
			type: "remove",
		});
	});
});

describe("stageRemoval 暂存写入", () => {
	it("向暂存区写入移除标记(空串)", () => {
		const override: Record<string, string> = {};
		stageRemoval(override, "@koishi-ce/plugin-echo");
		expect(override["@koishi-ce/plugin-echo"]).toBe("");
	});

	it("覆盖同包既有的版本暂存(先固定后卸载)", () => {
		const override: Record<string, string> = {
			"@koishi-ce/plugin-echo": "1.2.3",
		};
		stageRemoval(override, "@koishi-ce/plugin-echo");
		expect(
			decodeOverrideEntry(
				override["@koishi-ce/plugin-echo"],
			),
		).toEqual({ type: "remove" });
	});

	it("不影响暂存区内其他包的待应用变更", () => {
		const override: Record<string, string> = {
			"@koishi-ce/plugin-other": "2.0.0",
		};
		stageRemoval(override, "@koishi-ce/plugin-echo");
		expect(
			decodeOverrideEntry(
				override["@koishi-ce/plugin-other"],
			),
		).toEqual({ type: "set", version: "2.0.0" });
	});
});

describe("cancelRemoval 暂存撤销", () => {
	it("撤销移除标记后解码落空", () => {
		const override: Record<string, string> = {
			"@koishi-ce/plugin-echo": "",
		};
		cancelRemoval(override, "@koishi-ce/plugin-echo");
		expect("@koishi-ce/plugin-echo" in override).toBe(
			false,
		);
		expect(
			decodeOverrideEntry(
				override["@koishi-ce/plugin-echo"],
			),
		).toBeUndefined();
	});

	it("键本就不在时为无害空操作", () => {
		const override: Record<string, string> = {};
		expect(() =>
			cancelRemoval(override, "@koishi-ce/plugin-echo"),
		).not.toThrow();
	});
});

describe("resolveButtonState 按钮形态流转", () => {
	it("发起态:卸载文案 + 危险样式 + 可点", () => {
		expect(resolveButtonState(false, false)).toEqual({
			mode: "uninstall",
			danger: true,
			disabled: false,
		});
	});

	it("已暂存移除:转取消文案并退掉危险样式", () => {
		expect(resolveButtonState(true, false)).toEqual({
			mode: "cancel",
			danger: false,
			disabled: false,
		});
	});

	it("卸载执行中:闭锁点击", () => {
		expect(resolveButtonState(false, true)).toEqual({
			mode: "uninstall",
			danger: true,
			disabled: true,
		});
		expect(resolveButtonState(true, true)).toEqual({
			mode: "cancel",
			danger: false,
			disabled: true,
		});
	});
});
