// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Console, type Entry } from "@koishi-ce/console";
import { App, h, type Plugin, Service } from "@koishi-ce/koishi";
import notifier, { type Notifier } from "./index.ts";

/**
 * 控制台服务桩：仅实现入口登记所需的最小面（不做 WebSocket / 静态资源），
 * 使 notifier 等依赖 ctx.console 的插件可在无真实服务下加载。
 */
class FakeConsole extends Console {
	protected resolveEntry(_files: Entry.Files, _key: string): string[] {
		return [];
	}
}

/** loader 服务桩：为 toJSON 的 paths 分支提供可预期的返回值。 */
class FakeLoader extends Service {
	constructor(ctx: ConstructorParameters<typeof Service>[0]) {
		super(ctx, "loader", true);
	}

	paths() {
		return ["group:entry", "plugins"];
	}
}

interface FakeClient {
	id: string;
	socket: { send(payload: unknown): void };
	sent: { type: string; body: unknown }[];
}

/** 构造一个记录发送消息的假控制台客户端（挂入 clients 以驱动 broadcast）。 */
function createClient(console: FakeConsole): FakeClient {
	const client: FakeClient = {
		id: `client-${Math.random().toString(36).slice(2)}`,
		socket: {
			send(payload) {
				client.sent.push(JSON.parse(payload as string));
			},
		},
		sent: [],
	};
	console.clients[client.id] = client as never;
	return client;
}

const app = new App();

// Console 基类的 static inject 是 cordis 3 旧形态，与 Plugin.Constructor 期待类型不兼容，仅做类型层转型
app.plugin(FakeConsole as unknown as Plugin.Constructor<App>);
app.plugin(FakeLoader);
// NotifierService 的 static Config 与 plugin 重载的 Transform 推断不合（cordis 3 旧形态），
// 断言为 Constructor 后配置参数恢复宽收
app.plugin(notifier as unknown as Plugin.Constructor<App>, {});

const service = () => app.notifier;

beforeAll(() => app.start());

afterAll(async () => {
	await app.stop();
});

describe("notifier 服务", () => {
	it("加载后注册控制台入口与按钮监听", () => {
		expect(service().store).toEqual([]);
		expect(service().entry).toBeDefined();
		expect(app.console.listeners["notifier/button"]).toBeDefined();
	});

	it("create 接受字符串内容并规范化为段落元素", () => {
		const n = service().create("你好");
		expect(service().store).toHaveLength(1);
		expect(n.options.type).toBe("primary");
		expect(n.toJSON().content).toBe("<p>你好</p>");
		expect(n.toJSON().paths).toEqual(["group:entry", "plugins"]);
		n.dispose();
	});

	it("create 接受元素与完整选项对象", () => {
		const n = service().create({
			type: "danger",
			content: h("p", {}, "警告内容"),
		});
		expect(n.options.type).toBe("danger");
		expect(n.toJSON().content).toBe("<p>警告内容</p>");
		n.dispose();
	});

	it("update 刷新内容与级别", () => {
		const n = service().create("旧内容");
		n.update({ type: "warning", content: "新内容" });
		expect(n.options.type).toBe("warning");
		expect(n.toJSON().content).toBe("<p>新内容</p>");
		n.dispose();
	});

	it("button 的 onClick 被摘出为 key，点击回调经监听器触发", async () => {
		let clicked = 0;
		const n = service().create(
			h("p", {}, [h("button", { onClick: () => (clicked += 1) }, "点我")]),
		);
		// attrs 中的函数已被随机 key 替换
		const keys = Object.keys(service().actions);
		expect(keys).toHaveLength(1);
		expect(typeof service().actions[keys[0] as string]).toBe("function");
		expect(n.toJSON().content).toContain(`on-click="${keys[0]}"`);

		const listener = app.console.listeners["notifier/button"];
		await listener?.callback.call({} as never, keys[0] as string);
		expect(clicked).toBe(1);

		// 未知 key 不应抛错
		await listener?.callback.call({} as never, "not-exist");
		n.dispose();
	});

	it("更新内容时清空旧按钮回调，dispose 移除通知与回调", () => {
		let clicked = 0;
		const n = service().create(
			h("button", { onClick: () => (clicked += 1) }, "按钮"),
		);
		expect(Object.keys(service().actions)).toHaveLength(1);
		n.update("纯文本");
		expect(Object.keys(service().actions)).toHaveLength(0);
		// 原回调已注销，不再登记
		expect(service().actions).toEqual({});

		n.dispose();
		expect(service().store).toHaveLength(0);
	});

	it("message 向已连接客户端广播即时通知", async () => {
		const client = createClient(app.console as FakeConsole);
		service().message("即时消息");
		await new Promise((resolve) => setTimeout(resolve, 20));
		const last = client.sent.at(-1);
		expect(last?.type).toBe("notifier/message");
		expect(last?.body).toEqual({ type: "primary", content: "即时消息" });

		// 对象入参可携带级别
		service().message({ type: "success", content: "成功了" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(client.sent.at(-1)?.body).toEqual({
			type: "success",
			content: "成功了",
		});
		delete app.console.clients[client.id];
	});

	it("入口数据工厂输出全部通知的序列化列表", async () => {
		const n1: Notifier = service().create("通知一");
		const n2: Notifier = service().create({
			type: "danger",
			content: "通知二",
		});
		const data = service().entry?.data?.({} as never) as {
			notifiers: ReturnType<Notifier["toJSON"]>[];
		};
		expect(data.notifiers).toHaveLength(2);
		expect(data.notifiers[1]).toMatchObject({
			type: "danger",
			content: "<p>通知二</p>",
		});
		n1.dispose();
		n2.dispose();
	});
});
