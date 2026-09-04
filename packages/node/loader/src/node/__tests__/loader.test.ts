// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * loader 的加载与配置联动行为测试（配合 TestLoader 测试桩）。
 *
 * 桩不触碰文件系统：import 以内存注册表按名惰性生成 mock 插件，
 * saveConfig 只记录调用；createApp / update / filter 走真实装配链路。
 */
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	type Mock,
	mock,
} from "bun:test";
import type { Plugin } from "@koishi-ce/core";
import {
	Context,
	type Dict,
	Logger,
	sleep,
} from "@koishi-ce/koishi";
import mockClient from "@koishi-ce/plugin-mock";
import type { ResolvedConfigFile } from "../../base/config-file.ts";
import { Loader } from "../index.ts";

// 声明测试用事件，让 emit 调用走类型化的重载
declare module "@koishi-ce/core" {
	interface Events {
		"test/bar"(): void;
		"test/baz"(): void;
	}
}

/** loader 测试桩：不落盘、不解析真实模块的 Loader 实现 */
class TestLoader extends Loader {
	/** 插件名 -> mock 插件对象 的内存注册表 */
	data: Dict<unknown> = Object.create(null);

	/** 各插件最新注册的事件监听 mock（每次 apply 重建，观察触发情况） */
	listeners: Dict<Mock<() => void>> = Object.create(null);

	/** saveConfig 收到的写盘请求（配置回写链路的观察口） */
	writes: { filename: string; config: unknown }[] = [];

	/** 返回按名惰性创建的 mock 插件；foo 插件在 apply 时抛错以模拟加载失败 */
	override async import(name: string) {
		return (this.data[name] ||= {
			name,
			apply: (ctx: Context) => {
				if (name === "foo")
					throw new Error("error from plugin");
				const listener = mock();
				this.listeners[name] = listener;
				ctx.on(`test/${name}` as never, listener as never);
				ctx.accept();
			},
		});
	}

	/** 整进程重载在测试中仅打印提示 */
	override fullReload() {
		console.info("trigger full reload");
	}

	protected override locateConfig(): Promise<ResolvedConfigFile> {
		throw new Error(
			"test loader does not touch the file system",
		);
	}

	protected override async parseConfig(): Promise<unknown> {
		throw new Error(
			"test loader does not touch the file system",
		);
	}

	protected override async saveConfig(
		filename: string,
		config: unknown,
	) {
		this.writes.push({ filename, config });
	}
}

describe("@koishi-ce/loader", () => {
	const loader = new TestLoader();
	loader.writable = true;

	beforeAll(() => {
		// foo 插件 apply 抛错是预期场景，app 域静默（阈值 0 = SILENT）；
		// createApp 期间 loader 的 apply/unload 为生命周期 info，收敛为仅错误级
		const levels = Logger.levels as Record<string, number>;
		levels["app"] = 0;
		levels["loader"] = 1;
	});

	afterAll(() => {
		// 恢复域级配置，避免同一进程内后续测试文件被连带静默
		const levels = Logger.levels as Record<string, number>;
		delete levels["app"];
		delete levels["loader"];
	});

	// 验证 createApp 能按配置表正确挂载插件并传递配置
	it("loader.createApp()", async () => {
		loader.config = {
			prefix: ["."],
			plugins: {
				foo: {},
				"group:qux": {
					bar: {
						a: 1,
					},
				},
			},
		};

		const app = await loader.createApp();
		expect(app).toBeInstanceOf(Context);
		expect(app.koishi.config.prefix).toEqual(["."]);
		expect(
			app.registry.get(loader.data["foo"]! as Plugin),
		).toBeTruthy();
		expect(
			app.registry.get(loader.data["foo"]! as Plugin)
				?.config,
		).toEqual({});
		expect(
			app.registry.get(loader.data["bar"]! as Plugin),
		).toBeTruthy();
		expect(
			app.registry.get(loader.data["bar"]! as Plugin)
				?.config,
		).toEqual({
			a: 1,
		});
	});

	// 验证更新根配置后：$if 为假的插件被卸载、其余插件按新配置重载
	it("app.scope.update()", async () => {
		const { app } = loader;
		loader.config = {
			prefix: ["/"],
			plugins: {
				foo: {
					$if: false,
				},
				"group:qux": {
					$filter: {
						$eq: [{ $: "userId" }, "123"],
					},
					baz: {},
					bar: {
						a: 2,
						$filter: {
							$eq: [{ $: "channelId" }, "789"],
						},
					},
				},
			},
		};
		app.scope.update(loader.config);
		await sleep(0);
		expect(app.koishi.config.prefix).toEqual(["/"]);
		expect(
			app.registry.get(loader.data["foo"]! as Plugin),
		).toBeFalsy();
		expect(
			app.registry.get(loader.data["bar"]! as Plugin),
		).toBeTruthy();
		expect(
			app.registry.get(loader.data["bar"]! as Plugin)
				?.config,
		).toEqual({
			a: 2,
		});
		expect(
			app.registry.get(loader.data["baz"]! as Plugin),
		).toBeTruthy();
		expect(
			app.registry.get(loader.data["baz"]! as Plugin)
				?.config,
		).toEqual({});
	});

	// 验证运行期更新插件配置会同步回写 loader 的配置对象
	it("plugin update", async () => {
		const { app } = loader;
		const runtime = app.registry.get(
			loader.data["bar"]! as Plugin,
		);
		runtime?.update({ a: 3 });
		expect(loader.config.plugins).toEqual({
			foo: {
				$if: false,
			},
			"group:qux": {
				$filter: {
					$eq: [{ $: "userId" }, "123"],
				},
				baz: {},
				bar: {
					a: 3,
					$filter: {
						$eq: [{ $: "channelId" }, "789"],
					},
				},
			},
		});
	});

	// 验证 $filter 元属性生成的会话过滤器能按用户/频道条件拦截事件
	it("filter", async () => {
		const { app } = loader;
		app.plugin(mockClient);
		expect(app.lifecycle._hooks["test/bar"]).toHaveLength(
			1,
		);
		expect(app.lifecycle._hooks["test/baz"]).toHaveLength(
			1,
		);
		const bar = loader.listeners["bar"]!;
		const baz = loader.listeners["baz"]!;
		// mock 插件的监听器注册后未被调用
		expect(bar.mock.calls).toHaveLength(0);
		expect(baz.mock.calls).toHaveLength(0);

		// userId 123 命中 group 的 $filter，channelId 456 未命中 bar 的 $filter
		const first = app.mock.client("123", "456");
		app.emit(app.mock.session(first.event), "test/bar");
		app.emit(app.mock.session(first.event), "test/baz");
		expect(bar.mock.calls).toHaveLength(0);
		expect(baz.mock.calls).toHaveLength(1);

		// userId 321 未命中 group 的 $filter：两个监听器都不会触发
		const second = app.mock.client("321", "456");
		app.emit(app.mock.session(second.event), "test/bar");
		app.emit(app.mock.session(second.event), "test/baz");
		expect(bar.mock.calls).toHaveLength(0);
		expect(baz.mock.calls).toHaveLength(1);
	});

	// 验证运行期更新触发的配置回写会经 saveConfig 缝隙落盘
	it("writeConfig", async () => {
		await loader.writeConfig();
		await sleep(0);
		expect(loader.writes.length).toBeGreaterThan(0);
	});
});
