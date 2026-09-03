// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 应用装配测试：根上下文 dispose 触发整进程重载、CLI 透传的启动消息
 * 在目标机器人上线后送达一次（无 channelId 时仅注销监听）。
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { type Context, Logger, sleep, type Universal } from "@koishi-ce/koishi";
import type { ResolvedConfigFile } from "./config-file.ts";
import { Loader } from "./index.ts";
import { handleStartMessage } from "./wiring.ts";

beforeAll(() => {
	// createApp 期间 loader 的 apply 与启动横幅均为生命周期 info，收敛为仅错误级
	const levels = Logger.levels as Record<string, number>;
	levels["loader"] = 1;
	levels["app"] = 1;
});

afterAll(() => {
	// 恢复域级阈值，避免同进程后续测试文件被连带静默
	const levels = Logger.levels as Record<string, number>;
	delete levels["loader"];
	delete levels["app"];
});

/** loader 测试桩：不落盘、fullReload 仅记录调用 */
class TestLoader extends Loader {
	/** fullReload 收到的调用记录 */
	reloads: number[] = [];

	override async import() {
		return undefined;
	}

	override fullReload(code?: number) {
		this.reloads.push(code ?? -1);
	}

	protected override locateConfig(): Promise<ResolvedConfigFile> {
		throw new Error("test loader does not touch the file system");
	}

	protected override async parseConfig(): Promise<unknown> {
		return {};
	}

	protected override async saveConfig() {}
}

/**
 * bot-status-updated 事件载荷的精确类型：
 * 经 Context.events 符号取出合并后的事件表再提取（与 emit 重载的推导同源）。
 */
type StatusUpdatedBot = Parameters<
	Context[typeof Context.events]["bot-status-updated"]
>[0];

/** 构造 bot-status-updated 事件载荷的 mock 机器人 */
function makeBot(
	sid: string,
	status: Universal.Status,
	sendMessage: (channelId: string, content: string, guildId?: string) => void,
) {
	return { sid, status, sendMessage } as unknown as StatusUpdatedBot;
}

describe("wireAppEvents", () => {
	it("根上下文销毁时触发整进程重载", async () => {
		const loader = new TestLoader();
		loader.config = { plugins: {} } as Context.Config;
		const app = await loader.createApp();

		// dispose 监听经 scope.disposables 执行，需真正销毁根作用域
		app.scope.dispose();
		await sleep(10);
		expect(loader.reloads).toHaveLength(1);
	});
});

describe("handleStartMessage", () => {
	it("目标机器人上线后发送一次启动消息并注销监听", async () => {
		const loader = new TestLoader();
		loader.config = { plugins: {} } as Context.Config;
		const app = await loader.createApp();

		const sendMessage = mock();
		loader.envData.message = {
			sid: "discord:1",
			channelId: "c1",
			guildId: "g1",
			content: "hello",
		};
		handleStartMessage(loader, app);
		// 消息取出后立即清空，避免重启后重复发送
		expect(loader.envData.message).toBeNull();

		// 机器人未上线（status 不匹配）或 sid 不匹配时不发送
		app.emit(
			"bot-status-updated",
			makeBot("discord:1", 0 satisfies Universal.Status, sendMessage),
		);
		app.emit(
			"bot-status-updated",
			makeBot("discord:2", 1 satisfies Universal.Status, sendMessage),
		);
		expect(sendMessage).not.toHaveBeenCalled();

		// 目标机器人上线：发送并注销监听
		app.emit(
			"bot-status-updated",
			makeBot("discord:1", 1 satisfies Universal.Status, sendMessage),
		);
		expect(sendMessage).toHaveBeenCalledWith("c1", "hello", "g1");

		// 再次上线不再发送（监听器已注销）
		app.emit(
			"bot-status-updated",
			makeBot("discord:1", 1 satisfies Universal.Status, sendMessage),
		);
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});

	it("无 channelId 的启动消息上线后仅注销监听（不发送）", async () => {
		const loader = new TestLoader();
		loader.config = { plugins: {} } as Context.Config;
		const app = await loader.createApp();

		const sendMessage = mock();
		loader.envData.message = { sid: "x:1", content: "hi" };
		handleStartMessage(loader, app);
		app.emit(
			"bot-status-updated",
			makeBot("x:1", 1 satisfies Universal.Status, sendMessage),
		);
		expect(sendMessage).not.toHaveBeenCalled();
		// 监听器已注销：再上线也不会发送
		app.emit(
			"bot-status-updated",
			makeBot("x:1", 1 satisfies Universal.Status, sendMessage),
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("无启动消息时不注册监听", async () => {
		const loader = new TestLoader();
		loader.config = { plugins: {} } as Context.Config;
		const app = await loader.createApp();

		const sendMessage = mock();
		loader.envData.message = null;
		handleStartMessage(loader, app);
		app.emit(
			"bot-status-updated",
			makeBot("any:1", 1 satisfies Universal.Status, sendMessage),
		);
		expect(sendMessage).not.toHaveBeenCalled();
	});
});
