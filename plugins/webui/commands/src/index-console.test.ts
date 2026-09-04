// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
} from "bun:test";
import { Console, type Entry } from "@koishi-ce/console";
import { App, type Plugin } from "@koishi-ce/koishi";
import commands, { type CommandData } from "./index.ts";

/**
 * CommandManager 的 console 分支测试：installWebUI 的入口数据工厂（带缓存）
 * 与全部 command/* RPC 监听器；顺带覆盖 remove 的子指令交还、
 * write 的空对象清理与 aliases 数组简写 Schema。
 */

class StubConsole extends Console {
	static override inject = { optional: ["console"] };

	protected override resolveEntry(
		files: Entry.Files,
		_key: string,
	): string[] {
		if (typeof files === "string") return [files];
		if (Array.isArray(files)) return files;
		return [
			files.dev,
			...(Array.isArray(files.prod)
				? files.prod
				: [files.prod]),
		];
	}
}

const app = new App();
// Console 基类的 static inject 是 cordis 3 旧形态（{ optional: [...] }），
// 与 Plugin.Constructor 期待的 Dict<Meta> 不兼容，仅做类型层转型
app.plugin(
	StubConsole as unknown as Plugin.Constructor<App>,
);

// 预置两条指令：command（插件自身注册）之外再造一条可覆盖的普通指令
app.command("bar").action(() => "test");

const fork = app.plugin(commands, {});

beforeAll(() => app.start());
afterAll(() => app.stop());

/** 取 commands 前端入口的数据工厂产物 */
function entryData(): Record<string, CommandData> {
	const entry = Object.values(app.console.entries).find(
		(item) =>
			typeof item.files === "object" &&
			!Array.isArray(item.files),
	);
	expect(entry).toBeDefined();
	const data = entry?.data as
		| ((input?: unknown) => Record<string, CommandData>)
		| undefined;
	const result = data?.(undefined as never);
	expect(result).toBeDefined();
	return result ?? {};
}

/** 取 command/* 监听器回调（参数形态逐监听器不同，统一按 unknown 数组收窄） */
function listener(
	name: string,
): (...args: unknown[]) => unknown {
	const callback = app.console.listeners[name]?.callback;
	expect(callback).toBeDefined();
	return callback as unknown as (
		...args: unknown[]
	) => unknown;
}

describe("installWebUI 装配", () => {
	it("注册 command/* RPC 监听器", () => {
		const names = Object.keys(app.console.listeners).filter(
			(name) => name.startsWith("command/"),
		);
		expect(names.sort()).toEqual([
			"command/aliases",
			"command/create",
			"command/parse",
			"command/remove",
			"command/teleport",
			"command/update",
		]);
	});

	it("数据工厂下发全量指令快照并按指令名缓存", () => {
		const first = entryData();
		expect(first["command"]).toBeDefined();
		expect(first["bar"]).toBeDefined();
		expect(first["bar"]?.create).toBe(false);
		// 指令自身名也在别名表中（koishi 的注册约定）
		expect(first["bar"]?.initial.aliases).toEqual({
			bar: {},
		});
		expect(first["bar"]?.paths).toEqual([]);
		// 无覆盖的指令 override 以空值占位（config 为 null）
		expect(first["bar"]?.override.config).toBeNull();
		// 缓存：两次调用返回同一引用，refresh 驱动失效
		const second = entryData();
		expect(second).toBe(first);
	});

	it("command/parse 解析指令参数；指令不存在时报错", () => {
		const argv = listener("command/parse")(
			"bar",
			"abc --opt x",
		) as {
			args?: unknown[];
			options?: Record<string, unknown>;
		};
		expect(argv.args).toBeDefined();
		expect(() =>
			listener("command/parse")("missing-cmd", "x"),
		).toThrow("command not found: missing-cmd");
	});
});

describe("command/* RPC 监听器", () => {
	it("command/update：合并配置与选项覆盖并写回插件配置（空对象不落盘）", async () => {
		await listener("command/update")("bar", {
			config: { authority: 3 },
			// 空 option 条目：write 时应整体清理，不残留在配置里
			options: { alias: {} },
		});
		const bar = app.$commander.get("bar");
		expect(bar?.config.authority).toBe(3);
		const stored = fork.config["bar"] as Record<
			string,
			unknown
		>;
		expect(stored["config"]).toEqual({ authority: 3 });
		expect(stored).not.toHaveProperty("options");
	});

	it("command/aliases：整体替换别名表（差异才落盘，保留自身名）", async () => {
		await listener("command/aliases")("bar", {
			bar: {},
			br: {},
		});
		expect(app.$commander.resolve("br")).toBeDefined();
		const stored = fork.config["bar"] as Record<
			string,
			unknown
		>;
		// bar 自身名与 initial 相同 → 差异过滤后只落盘 br
		expect(stored["aliases"]).toEqual({ br: {} });
	});

	it("command/teleport：挂到父指令并写入归属", async () => {
		app.command("foo");
		await listener("command/teleport")("bar", "foo");
		expect(
			app.$commander
				.get("foo")
				?.children.map((c) => c.name),
		).toContain("bar");
		const stored = fork.config["bar"] as Record<
			string,
			unknown
		>;
		expect(stored["name"]).toBe("foo/bar");
	});

	it("command/create 与 command/remove：创建/销毁由插件管理的指令", async () => {
		await listener("command/create")("brand-new");
		expect(app.$commander.get("brand-new")).toBeDefined();
		expect(
			(fork.config["brand-new"] as Record<string, unknown>)[
				"create"
			],
		).toBe(true);
		// 数据工厂对快照指令标记 create 并带 initial（refresh 的 debounce 与
		// write 触发的插件重启均需等 tick 生效）
		await app.sleep(10);
		const data = entryData();
		expect(data["brand-new"]?.create).toBe(true);

		await listener("command/remove")("brand-new");
		expect(app.$commander.get("brand-new")).toBeUndefined();
		expect(fork.config).not.toHaveProperty("brand-new");
	});

	it("remove 销毁父指令时把子指令交还给快照记录的父级", async () => {
		// kid 生于 keeper 之下并建立快照（parent 记录为 keeper），
		// 随后经 teleport 挂到 victim 下；remove(victim) 应把 kid 还给 keeper
		app.command("keeper");
		app.command("keeper/kid").action(() => "kid");
		app.command("victim");
		// 注意子指令的注册名与别名键均为尾段 "kid"
		await listener("command/aliases")("kid", {
			kid: {},
			kd: {},
		});
		await listener("command/aliases")("victim", {
			victim: {},
			vic: {},
		});
		await listener("command/teleport")("kid", "victim");
		const victim = app.$commander.get("victim");
		expect(victim?.children.map((c) => c.name)).toContain(
			"kid",
		);

		await listener("command/remove")("victim");
		expect(app.$commander.get("victim")).toBeUndefined();
		const kid = app.$commander.get("kid");
		expect(kid).toBeDefined();
		// 子指令回到快照记录的原父级（keeper）之下
		expect(kid?.parent?.name).toBe("keeper");
		expect(
			app.$commander
				.get("keeper")
				?.children.map((c) => c.name),
		).toContain("kid");
	});
});

describe("配置侧 Schema", () => {
	it("aliases 支持字符串数组简写（等价值全空对象的字典）", async () => {
		// 用独立于插件生命周期的指令，避免插件卸载时连带销毁目标指令
		app.command("standalone").action(() => "x");
		await fork.dispose();
		await app.registry.delete(commands);
		const second = app.plugin(commands, {
			standalone: { aliases: ["sa"] },
			// aliases 的字符串数组简写由 Schema 在运行时归一化，类型层不收数组形态，
			// 这里仅做类型层断言以保持既有运行时行为
		} as never);
		expect(app.$commander.resolve("sa")).toBeDefined();
		const stored = second.config["standalone"] as Record<
			string,
			unknown
		>;
		expect(stored["aliases"]).toEqual({ sa: {} });
		await second.dispose();
		await app.registry.delete(commands);
		// 收尾恢复主 fork，供后续用例使用
		await app.plugin(commands, {});
	});
});
