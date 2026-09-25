// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/client RPC 数据层（data.ts）的单元测试。
 *
 * 以假 WebSocket（记录报文、手工派发事件）+ 最小 Context 桩覆盖：
 * - data / patch 推送对全局 store 的整表覆盖与增量合并语义；
 * - send 的报文形态、response 按 id 结算（value / error）与 60s 超时；
 * - receive 的注册与覆盖语义、message 对监听与 cordis 事件的双重分发；
 * - connect 的心跳（interval 发 ping / timeout 主动断开）与断线重连
 *   （清空 store、1s 后重连、重连失败不刷新页面）。
 *
 * 时间推进统一走 bun:test 的 jest 兼容 mock timers（本仓依赖纪律，
 * 见 plugins/common/rate-limit 的同款用法）；此文件不进 client 类型
 * 程序（tsconfig.web.json 的 *.test.ts exclude，bun test 运行时覆盖）。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	jest,
} from "bun:test";
import type { Universal } from "@koishi-ce/koishi";
import type { Context } from "./context.ts";

// data.ts 模块加载期读取构建期注入的 KOISHI_CONFIG 全局（浏览器里由
// define 替换；bun test 下该自由变量沿作用域链解析到 globalThis），
// 须先注入再动态导入
(globalThis as Record<string, unknown>)["KOISHI_CONFIG"] = {
	devMode: false,
	uiPath: "/console",
	endpoint: "/status",
};

const { connect, global, receive, send, socket, store } =
	await import("./data.ts");

/** 测试用假 WebSocket：记录发送报文、手工派发事件 */
class FakeWebSocket {
	sent: string[] = [];
	closed = false;
	private handlers = new Map<
		string,
		((ev: never) => void)[]
	>();

	addEventListener(
		type: string,
		listener: (ev: never) => void,
	) {
		const list = this.handlers.get(type) ?? [];
		list.push(listener);
		this.handlers.set(type, list);
	}

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		this.closed = true;
	}

	emit(type: string, ev: unknown) {
		for (const listener of this.handlers.get(type) ?? []) {
			listener(ev as never);
		}
	}
}

/** 最小 Context 桩：记录 emit 转发 */
function makeCtx() {
	const emitted: Array<[string, unknown]> = [];
	return {
		emitted,
		ctx: {
			emit: (type: string, body: unknown) => {
				emitted.push([type, body]);
			},
		} as unknown as Context,
	};
}

/** 以给定实例发起 connect 并完成 open 握手 */
async function openSocket(instances: FakeWebSocket[]) {
	const { ctx } = makeCtx();
	const opening = connect(ctx, () => {
		const socket = new FakeWebSocket();
		instances.push(socket);
		return socket as unknown as Universal.WebSocket;
	});
	instances[0]?.emit("open", { type: "open" });
	await opening;
	return ctx;
}

// data.ts 的收发路径都打 console.debug、断线打 console.log：测试期
// 静默 debug、收集 log（重连用例对其做断言）
const debugOriginal = console.debug;
const logOriginal = console.log;
const logs: unknown[][] = [];

beforeAll(() => {
	console.debug = () => {};
	console.log = (...args: unknown[]) => {
		logs.push(args);
	};
});

afterAll(() => {
	console.debug = debugOriginal;
	console.log = logOriginal;
});

describe("store 数据同步（data / patch 推送）", () => {
	const instances: FakeWebSocket[] = [];
	let ws: FakeWebSocket;

	beforeAll(async () => {
		await openSocket(instances);
		ws = instances[0]!;
	});

	it("data 事件按 key 整表覆盖 store", () => {
		ws.emit("message", {
			data: JSON.stringify({
				type: "data",
				body: { key: "entry", value: { _id: "e1" } },
			}),
		});
		expect(
			(store as Record<string, unknown>)["entry"],
		).toEqual({ _id: "e1" });
	});

	it("patch 事件对数组载荷做追加", () => {
		ws.emit("message", {
			data: JSON.stringify({
				type: "data",
				body: { key: "list", value: [1] },
			}),
		});
		ws.emit("message", {
			data: JSON.stringify({
				type: "patch",
				body: { key: "list", value: [2, 3] },
			}),
		});
		expect(
			(store as Record<string, unknown>)["list"],
		).toEqual([1, 2, 3]);
	});

	it("patch 事件对对象载荷做浅合并", () => {
		ws.emit("message", {
			data: JSON.stringify({
				type: "data",
				body: { key: "obj", value: { a: 1, b: 2 } },
			}),
		});
		ws.emit("message", {
			data: JSON.stringify({
				type: "patch",
				body: { key: "obj", value: { b: 3 } },
			}),
		});
		expect(
			(store as Record<string, unknown>)["obj"],
		).toEqual({ a: 1, b: 3 });
	});

	it("patch 事件对尚无数据的键不做任何事", () => {
		ws.emit("message", {
			data: JSON.stringify({
				type: "patch",
				body: { key: "never-pushed", value: { a: 1 } },
			}),
		});
		expect(
			(store as Record<string, unknown>)["never-pushed"],
		).toBeUndefined();
	});
});

describe("send 与 response 结算", () => {
	const instances: FakeWebSocket[] = [];
	let ws: FakeWebSocket;

	beforeAll(async () => {
		await openSocket(instances);
		ws = instances[0]!;
	});

	it("open 后 socket 就位且指向当前连接实例", () => {
		expect(socket.value).toBe(
			ws as unknown as Universal.WebSocket,
		);
	});

	it("发送 { id, type, args } 报文，response 按 id 结算 value", async () => {
		const promise = send("get", 1, "a") as Promise<unknown>;
		const frame = JSON.parse(ws.sent.at(-1)!) as {
			id: string;
			type: string;
			args: unknown[];
		};
		expect(frame.type).toBe("get");
		expect(frame.args).toEqual([1, "a"]);
		ws.emit("message", {
			data: JSON.stringify({
				type: "response",
				body: { id: frame.id, value: "ok" },
			}),
		});
		expect(await promise).toBe("ok");
	});

	it("response 携带 error 时按原值 reject", async () => {
		const promise = send("boom") as Promise<unknown>;
		const frame = JSON.parse(ws.sent.at(-1)!) as {
			id: string;
		};
		ws.emit("message", {
			data: JSON.stringify({
				type: "response",
				body: { id: frame.id, error: { message: "炸了" } },
			}),
		});
		await expect(promise).rejects.toEqual({
			message: "炸了",
		});
	});

	it("未知 id 的 response 直接忽略", () => {
		ws.emit("message", {
			data: JSON.stringify({
				type: "response",
				body: { id: "no-such-hook", value: 1 },
			}),
		});
	});

	it("60s 未收到应答按超时 reject", async () => {
		jest.useFakeTimers();
		try {
			// 不用 expect().rejects 直接挂起断言：其内部微任务与
			// bun 的 fake timers 组合会把用例挂死（实证），先经
			// catch 收拢再对捕获值断言
			let caught: unknown;
			const promise = send("slow")!.catch((error) => {
				caught = error;
			});
			jest.advanceTimersByTime(60_001);
			await promise;
			expect((caught as Error).message).toBe("timeout");
		} finally {
			jest.useRealTimers();
		}
	});

	it("未连接时 send 静默返回 undefined（不发报文不建钩子）", () => {
		const original = socket.value;
		socket.value = null;
		try {
			expect(send("offline")).toBeUndefined();
		} finally {
			socket.value = original;
		}
	});
});

describe("receive 与消息分发", () => {
	const instances: FakeWebSocket[] = [];
	const { ctx, emitted } = makeCtx();
	let ws: FakeWebSocket;

	beforeAll(async () => {
		const opening = connect(ctx, () => {
			const socket = new FakeWebSocket();
			instances.push(socket);
			return socket as unknown as Universal.WebSocket;
		});
		instances[0]?.emit("open", { type: "open" });
		await opening;
		ws = instances[0]!;
	});

	it("message 分发到 receive 注册的监听并转发为 cordis 事件", () => {
		const got: unknown[] = [];
		receive("custom", (data) => got.push(data));
		ws.emit("message", {
			data: JSON.stringify({
				type: "custom",
				body: { x: 1 },
			}),
		});
		expect(got).toEqual([{ x: 1 }]);
		expect(emitted).toContainEqual(["custom", { x: 1 }]);
	});

	it("同名事件重复注册仅保留最后一个监听", () => {
		const first: unknown[] = [];
		const second: unknown[] = [];
		receive("dup", (data) => first.push(data));
		receive("dup", (data) => second.push(data));
		ws.emit("message", {
			data: JSON.stringify({ type: "dup", body: 1 }),
		});
		expect(first).toEqual([]);
		expect(second).toEqual([1]);
	});
});

describe("断线重连", () => {
	it("close 后清空 store，1s 后重连；重连失败不刷新页面", async () => {
		const instances: FakeWebSocket[] = [];
		await openSocket(instances);
		instances[0]?.emit("message", {
			data: JSON.stringify({
				type: "data",
				body: { key: "k", value: 7 },
			}),
		});
		expect((store as Record<string, unknown>)["k"]).toBe(7);

		jest.useFakeTimers();
		try {
			instances[0]?.emit("close", { type: "close" });
			expect(socket.value).toBeNull();
			// 断线期间的数据已不可信：store 被清空等待重连后重拉
			expect(
				(store as Record<string, unknown>)["k"],
			).toBeUndefined();

			jest.advanceTimersByTime(1000);
			// 重连已发起：第二个实例被创建，但尚未握手
			expect(instances).toHaveLength(2);
			instances[1]?.emit("error", new Error("重连失败"));
			await Promise.resolve();
			// 失败走日志分支而非 location.reload
			expect(
				logs.some((args) =>
					String(args[0]).includes(
						"websocket disconnected",
					),
				),
			).toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});
});

describe("心跳（heartbeat）", () => {
	it("interval 到点发送 ping，timeout 无消息则主动断开", async () => {
		const instances: FakeWebSocket[] = [];
		await openSocket(instances);
		const ws = instances[0]!;

		global.heartbeat = { interval: 1000, timeout: 2000 };
		// fake timers 须先于首条消息安装：refresh 的 ping/close 计时器
		// 在 message 事件里注册，晚装的话注册到的是真实 timer 推不动
		jest.useFakeTimers();
		try {
			ws.emit("message", {
				data: JSON.stringify({
					type: "data",
					body: { key: "k", value: 1 },
				}),
			});
			jest.advanceTimersByTime(1000);
			expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({
				type: "ping",
			});
			jest.advanceTimersByTime(1000);
			// 距末条消息 2s 无消息：主动断开触发重连
			expect(ws.closed).toBe(true);
		} finally {
			jest.useRealTimers();
			global.heartbeat = undefined;
		}
	});
});
