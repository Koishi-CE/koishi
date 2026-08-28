import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file state.ts 的单元测试:configWriter 定位、手动添加依赖的元数据
 * 拉取与版本降序缓存、共享 ref 的初始状态。
 */

vi.mock("@koishi-ce/client", async () => {
	const { createKoishiClientStub } = await import("../../__tests__/helpers");
	return createKoishiClientStub();
});

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { send } = (await import(
	"@koishi-ce/client"
)) as unknown as KoishiClientStub;
const {
	MARKET_NEXT_PACKAGE,
	addManual,
	expandedDependency,
	getConfigWriter,
	manualDeps,
	showConfirm,
	showEnvironmentVersions,
	showInstallHistory,
	showManual,
} = await import("../state");

beforeEach(() => {
	send.mockReset();
	for (const key of Object.keys(manualDeps)) delete manualDeps[key];
});

describe("getConfigWriter", () => {
	it("返回 ctx.get 取到的 configWriter 服务", () => {
		const writer = { get: vi.fn(), ensure: vi.fn(), remove: vi.fn() };
		const ctx = { get: vi.fn(() => writer) } as any;
		expect(getConfigWriter(ctx)).toBe(writer);
		expect(ctx.get).toHaveBeenCalledWith("configWriter");
	});

	it("未安装 config 插件时返回 undefined", () => {
		const ctx = { get: vi.fn(() => undefined) } as any;
		expect(getConfigWriter(ctx)).toBeUndefined();
	});
});

describe("addManual", () => {
	it("拉取元数据后按版本降序缓存,返回值与缓存内容一致", async () => {
		send.mockResolvedValue({
			versions: { "1.0.0": {}, "2.0.0": {}, "1.10.0": {}, "1.2.0": {} },
		});
		const data = await addManual("pkg-a");
		expect(Object.keys(manualDeps["pkg-a"].versions)).toEqual([
			"2.0.0",
			"1.10.0",
			"1.2.0",
			"1.0.0",
		]);
		// manualDeps 是 reactive 代理,与原始对象按结构比较而非引用
		expect(data).toEqual(manualDeps["pkg-a"]);
		expect(send).toHaveBeenCalledWith("market/package", "pkg-a");
	});

	it("响应缺 versions 时抛错且不落缓存", async () => {
		send.mockResolvedValue(undefined);
		await expect(addManual("pkg-b")).rejects.toThrow(
			"failed to fetch package metadata: pkg-b",
		);
		expect(manualDeps["pkg-b"]).toBeUndefined();
		send.mockResolvedValue({ foo: 1 });
		await expect(addManual("pkg-b")).rejects.toThrow();
		expect(manualDeps["pkg-b"]).toBeUndefined();
	});

	it("RPC 拒绝时异常向上传播", async () => {
		send.mockRejectedValue(new Error("socket closed"));
		await expect(addManual("pkg-c")).rejects.toThrow("socket closed");
	});
});

describe("共享状态初始值", () => {
	it("各对话框开关与展开态默认收起", () => {
		expect(showManual.value).toBe(false);
		expect(showConfirm.value).toBe(false);
		expect(showInstallHistory.value).toBe(false);
		expect(showEnvironmentVersions.value).toBe(false);
		expect(expandedDependency.value).toBe("");
	});

	it("自更新判据常量是本插件包名", () => {
		expect(MARKET_NEXT_PACKAGE).toBe("@koishi-ce/plugin-marketn");
	});
});
