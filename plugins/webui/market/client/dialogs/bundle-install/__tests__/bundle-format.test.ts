import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @file 合包成员展示辅助函数的单元测试。
 *
 * mock @koishi-ce/client 的 store(market/state 的 receive 副作用同时覆盖),
 * 验证分类兜底/多语言描述挑选/安装状态文案/风险标签集合/预置判定。
 */

const store = {
	registry: {} as any,
	dependencies: {} as any,
	packages: {} as any,
	market: undefined as any,
};

vi.mock("@koishi-ce/client", () => ({
	store,
	receive: () => {},
	send: () => undefined,
}));

const {
	formatConfig,
	getInstalledText,
	getPackageDescription,
	hasPreset,
	memberCategory,
	riskTags,
	sensitiveFields,
} = await import("../bundle-format");

const t = (key: string, args?: any) =>
	args ? `${key}:${JSON.stringify(args)}` : key;

beforeEach(() => {
	store.registry = {};
	store.dependencies = {};
	store.packages = {};
	store.market = undefined;
});

describe("memberCategory", () => {
	it("无市场数据时兜底 other,有数据取条目分类", () => {
		expect(memberCategory("koishi-plugin-foo")).toBe("other");
		store.market = {
			data: { "koishi-plugin-foo": { category: "adapter" } },
		} as any;
		expect(memberCategory("koishi-plugin-foo")).toBe("adapter");
	});
});

describe("getPackageDescription", () => {
	// 多语言挑选职责已移交宿主 useI18nText,测试注入固定挑选函数验证数据取值优先级
	const pick = (message?: string | Record<string, string>) =>
		typeof message === "string"
			? message
			: message?.["zh-CN"] || message?.["en-US"];

	it("字符串描述透传挑选函数", () => {
		store.market = {
			data: { "pkg-a": { package: { description: "hello" } } },
		} as any;
		expect(getPackageDescription("pkg-a", pick)).toBe("hello");
	});

	it("manifest 描述优先于 package 描述", () => {
		store.market = {
			data: {
				"pkg-a": {
					manifest: {
						description: { "zh-CN": "首选", "en-US": "manifest-en" },
					},
					package: { description: { "en-US": "package-en" } },
				},
			},
		} as any;
		expect(getPackageDescription("pkg-a", pick)).toBe("首选");
		expect(getPackageDescription("pkg-a", (m) => m?.["en-US"])).toBe(
			"manifest-en",
		);
	});

	it("manifest 描述挑选为空时回退 package 描述", () => {
		store.market = {
			data: {
				"pkg-a": {
					manifest: { description: {} },
					package: { description: "fallback" },
				},
			},
		} as any;
		expect(getPackageDescription("pkg-a", pick)).toBe("fallback");
	});
});

describe("getInstalledText", () => {
	it("依赖已解析为已安装,仅 packages 为已加载,否则未安装", () => {
		expect(getInstalledText("pkg-a", t)).toBe("bundle.members.notInstalled");
		store.packages = { "pkg-a": { package: { version: "1.0.0" } } } as any;
		expect(getInstalledText("pkg-a", t)).toContain("bundle.members.loaded");
		store.dependencies = { "pkg-a": { resolved: "1.2.0" } } as any;
		expect(getInstalledText("pkg-a", t)).toContain("bundle.members.installed");
	});
});

describe("hasPreset / formatConfig / sensitiveFields", () => {
	it("空对象视为无预置", () => {
		expect(hasPreset({ config: {} } as any)).toBe(false);
		expect(hasPreset({ config: { token: "x" } } as any)).toBe(true);
		expect(hasPreset({} as any)).toBe(false);
	});

	it("formatConfig 空值兜底为空对象 JSON", () => {
		expect(formatConfig(undefined)).toBe("{}");
		expect(formatConfig({ a: 1 })).toBe('{\n  "a": 1\n}');
	});

	it("敏感字段来自 scanSensitiveConfig 判定", () => {
		expect(
			sensitiveFields({ config: { token: "a", name: "b" } } as any),
		).toContain("token");
		expect(sensitiveFields({ config: { name: "b" } } as any)).toHaveLength(0);
	});
});

describe("riskTags", () => {
	it("市场缺失给 warning,其余按条目标签聚合", () => {
		expect(riskTags({ config: {} } as any, t)).toEqual([
			{ label: "bundle.members.marketMissing", type: "warning" },
		]);
		store.market = {
			data: { "pkg-a": { verified: true, insecure: true } },
		} as any;
		const tags = riskTags({ package: "pkg-a", config: {} } as any, t);
		expect(tags).toContainEqual({
			label: "bundle.members.verified",
			type: "success",
		});
		expect(tags).toContainEqual({
			label: "bundle.members.insecure",
			type: "danger",
		});
	});

	it("registry 版本元数据的弃用标记也计入", () => {
		store.market = { data: { "pkg-a": {} } } as any;
		store.registry = { "pkg-a": { "1.0.0": { deprecated: "use v2" } } } as any;
		const tags = riskTags(
			{ package: "pkg-a", version: "1.0.0", config: {} } as any,
			t,
		);
		expect(tags).toContainEqual({
			label: "bundle.members.deprecated",
			type: "danger",
		});
	});
});
