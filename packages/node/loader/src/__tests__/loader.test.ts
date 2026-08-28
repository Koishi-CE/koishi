import { describe, it } from "bun:test";
import type { Mock } from "node:test";
import { Context, sleep } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import { expect } from "chai";
import Loader from "./utils";

/** loader 的加载与配置联动行为测试（配合 TestLoader 测试桩） */
describe("@koishi-ce/loader", () => {
	const loader = new Loader();
	loader.writable = true;

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
		expect(app).to.be.instanceof(Context);
		expect(app.koishi.config.prefix).to.deep.equal(["."]);
		expect(app.registry.get(loader.data.foo)).to.be.ok;
		expect(app.registry.get(loader.data.foo)?.config).to.deep.equal({});
		expect(app.registry.get(loader.data.bar)).to.be.ok;
		expect(app.registry.get(loader.data.bar)?.config).to.deep.equal({ a: 1 });
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
		expect(app.koishi.config.prefix).to.deep.equal(["/"]);
		expect(app.registry.get(loader.data.foo)).to.be.not.ok;
		expect(app.registry.get(loader.data.bar)).to.be.ok;
		expect(app.registry.get(loader.data.bar)?.config).to.deep.equal({ a: 2 });
		expect(app.registry.get(loader.data.baz)).to.be.ok;
		expect(app.registry.get(loader.data.baz)?.config).to.deep.equal({});
	});

	// 验证运行期更新插件配置会同步回写 loader 的配置对象
	it("plugin update", async () => {
		const { app } = loader;
		const runtime = app.registry.get(loader.data.bar);
		runtime?.update({ a: 3 });
		expect(loader.config.plugins).to.deep.equal({
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
		app.plugin(mock);
		expect(app.lifecycle._hooks["test/bar"]).to.have.length(1);
		expect(app.lifecycle._hooks["test/baz"]).to.have.length(1);
		const bar = app.lifecycle._hooks["test/bar"][0].callback as Mock<
			() => void
		>;
		const baz = app.lifecycle._hooks["test/baz"][0].callback as Mock<
			() => void
		>;
		expect(bar.mock.calls).to.have.length(0);
		expect(baz.mock.calls).to.have.length(0);

		let { event } = app.mock.client("123", "456");
		app.emit(app.mock.session(event), "test/bar" as any);
		app.emit(app.mock.session(event), "test/baz" as any);
		expect(bar.mock.calls).to.have.length(0);
		expect(baz.mock.calls).to.have.length(1);

		event = app.mock.client("321", "456").event;
		app.emit(app.mock.session(event), "test/bar" as any);
		app.emit(app.mock.session(event), "test/baz" as any);
		expect(bar.mock.calls).to.have.length(0);
		expect(baz.mock.calls).to.have.length(1);
	});
});
