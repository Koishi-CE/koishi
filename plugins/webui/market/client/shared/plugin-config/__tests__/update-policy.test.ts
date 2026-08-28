import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KoishiClientStub } from "../../__tests__/helpers";

/**
 * @file 更新忽略策略族的单元测试。
 *
 * store 用最小桩替换,聚焦验证忽略判定语义:候选版本筛选(比已装新/降序)、
 * 精确版本忽略、count 连坐、until 过期、禁检包短路、本地依赖无候选、
 * createUpdateIgnoreRule 的 options 覆盖与时长/次数边界、忽略文案的组装。
 */

vi.mock("@koishi-ce/client", async () => {
	const { createKoishiClientStub } = await import("../../__tests__/helpers");
	return createKoishiClientStub();
});

const i18nMock = vi.hoisted(() => ({
	translate: vi.fn((key: string, params?: any) =>
		params ? `${key}:${JSON.stringify(params)}` : key,
	),
}));

vi.mock("../../i18n", () => ({ translate: i18nMock.translate }));

// vi.mock 只是运行时替换,tsc 仍按真实模块类型推导;统一断言为桩视图
const { store } = (await import(
	"@koishi-ce/client"
)) as unknown as KoishiClientStub;
const {
	createUpdateIgnoreRule,
	getIgnoredUpdateVersion,
	getLatestVersion,
	getUpdateIgnoreText,
	hasUpdate,
	isUpdateCheckDisabled,
	isUpdateIgnored,
} = await import("../update-policy");

/** 便捷布置:registry 提供三个版本,已装 1.0.0,候选即 [2.0.0, 1.1.0]。 */
function setupVersions(resolved = "1.0.0") {
	store.registry = { "pkg-a": { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} } };
	store.dependencies = { "pkg-a": { resolved } };
}

beforeEach(() => {
	store.registry = {};
	store.dependencies = {};
	i18nMock.translate.mockClear();
});

describe("getLatestVersion / hasUpdate", () => {
	it("无忽略规则时返回最高候选版本", () => {
		setupVersions();
		expect(getLatestVersion("pkg-a")).toBe("2.0.0");
		expect(hasUpdate("pkg-a")).toBe(true);
	});

	it("已装最新版时无候选,hasUpdate 返回 undefined", () => {
		setupVersions("2.0.0");
		expect(getLatestVersion("pkg-a")).toBeUndefined();
		expect(hasUpdate("pkg-a")).toBeUndefined();
	});

	it("本地依赖(file 安装)不算升级候选", () => {
		setupVersions();
		store.dependencies["pkg-a"].source = "file";
		expect(getLatestVersion("pkg-a")).toBeUndefined();
		expect(hasUpdate("pkg-a")).toBeUndefined();
	});

	it("依赖条目缺 resolved 时无候选(hasUpdate 的 gt 兜底 catch 不可达)", () => {
		store.registry = { "pkg-a": { "2.0.0": {} } };
		store.dependencies = { "pkg-a": {} };
		expect(getLatestVersion("pkg-a")).toBeUndefined();
		expect(hasUpdate("pkg-a")).toBeUndefined();
	});
});

describe("忽略规则判定", () => {
	it('忽略最高候选后其下候选一并忽略,但"已忽略版本"标记仍指向它', () => {
		setupVersions();
		const policy = { updateIgnored: { "pkg-a": { version: "2.0.0" } } };
		expect(getLatestVersion("pkg-a", policy)).toBeUndefined();
		expect(getIgnoredUpdateVersion("pkg-a", policy)).toBe("2.0.0");
		expect(isUpdateIgnored("pkg-a", policy)).toBe(true);
	});

	it("count 向上连坐:忽略次新 1.1.0 且 count=2 时更高的 2.0.0 也被忽略", () => {
		setupVersions();
		expect(
			getLatestVersion("pkg-a", {
				updateIgnored: { "pkg-a": { version: "1.1.0", count: 2 } },
			}),
		).toBeUndefined();
		expect(
			getLatestVersion("pkg-a", {
				updateIgnored: { "pkg-a": { version: "1.1.0", count: 1 } },
			}),
		).toBe("2.0.0");
	});

	it("until 已过期的规则不再忽略", () => {
		setupVersions();
		const policy = {
			updateIgnored: {
				"pkg-a": { version: "2.0.0", until: Date.now() - 1000 },
			},
		};
		expect(getLatestVersion("pkg-a", policy)).toBe("2.0.0");
		expect(isUpdateIgnored("pkg-a", policy)).toBe(false);
	});

	it("禁检包短路:无候选、不标已忽略", () => {
		setupVersions();
		const policy = { updateIgnoredPackages: "pkg-a" };
		expect(getLatestVersion("pkg-a", policy)).toBeUndefined();
		expect(getIgnoredUpdateVersion("pkg-a", policy)).toBeUndefined();
		expect(hasUpdate("pkg-a", policy)).toBeUndefined();
	});

	it("isUpdateCheckDisabled 为共享判定的重导出(忽略空白与分隔符)", () => {
		expect(
			isUpdateCheckDisabled("pkg-a", {
				updateIgnoredPackages: " pkg-a , other ",
			}),
		).toBe(true);
		expect(
			isUpdateCheckDisabled("PKG-A", { updateIgnoredPackages: "pkg-a" }),
		).toBe(true);
		expect(
			isUpdateCheckDisabled("pkg-b", { updateIgnoredPackages: "pkg-a" }),
		).toBe(false);
	});

	it("无任何升级候选时已忽略标记也为空", () => {
		setupVersions("2.0.0");
		expect(
			getIgnoredUpdateVersion("pkg-a", { updateIgnored: { "pkg-a": "2.0.0" } }),
		).toBeUndefined();
		expect(isUpdateIgnored("pkg-a")).toBe(false);
	});
});

describe("createUpdateIgnoreRule", () => {
	it("默认目标是当前最新候选,count 归一为 1", () => {
		setupVersions();
		const rule = createUpdateIgnoreRule("pkg-a");
		expect(rule).toMatchObject({ version: "2.0.0", count: 1 });
		expect(rule?.until).toBeUndefined();
	});

	it("options 覆盖时长与次数", () => {
		setupVersions();
		const before = Date.now();
		const rule = createUpdateIgnoreRule("pkg-a", undefined, {
			duration: 3600_000,
			count: 3,
		});
		expect(rule?.count).toBe(3);
		expect(rule?.until!).toBeGreaterThanOrEqual(before + 3600_000);
	});

	it("时长缺省回落策略配置,负时长归零(不设 until)", () => {
		setupVersions();
		const before = Date.now();
		const rule = createUpdateIgnoreRule("pkg-a", {
			updateIgnoreDuration: 600_000,
		});
		expect(rule?.until!).toBeGreaterThanOrEqual(before + 600_000);
		expect(
			createUpdateIgnoreRule("pkg-a", undefined, { duration: -5 })?.until,
		).toBeUndefined();
		expect(
			createUpdateIgnoreRule("pkg-a", { updateIgnoreDuration: 0 })?.until,
		).toBeUndefined();
	});

	it("次数回落策略配置并做归一(0/非有限值归 1,超上限截到 20)", () => {
		setupVersions();
		expect(
			createUpdateIgnoreRule("pkg-a", { updateIgnoreVersions: 0 })?.count,
		).toBe(1);
		expect(
			createUpdateIgnoreRule("pkg-a", { updateIgnoreVersions: 25 })?.count,
		).toBe(20);
		expect(createUpdateIgnoreRule("pkg-a")?.count).toBe(1);
	});

	it("无升级候选时返回 undefined", () => {
		setupVersions("2.0.0");
		expect(createUpdateIgnoreRule("pkg-a")).toBeUndefined();
	});
});

describe("getUpdateIgnoreText", () => {
	it("无策略或规则缺版本时返回空串", () => {
		expect(getUpdateIgnoreText("pkg-a")).toBe("");
		expect(getUpdateIgnoreText("pkg-a", {})).toBe("");
		expect(
			getUpdateIgnoreText("pkg-a", {
				updateIgnored: { "pkg-a": { count: 3 } },
			}),
		).toBe("");
		expect(
			getUpdateIgnoreText("pkg-b", { updateIgnored: { "pkg-a": "2.0.0" } }),
		).toBe("");
	});

	it("字符串规则归一后仅展示版本行(count 为 1 不展示次数)", () => {
		const text = getUpdateIgnoreText("pkg-a", {
			updateIgnored: { "pkg-a": "2.0.0" },
		});
		expect(text).toBe('common.ignore.version:{"version":"2.0.0"}');
	});

	it("count 大于 1 时追加次数行,until 存在时追加截止时间行", () => {
		const until = Date.now() + 3600_000;
		const text = getUpdateIgnoreText("pkg-a", {
			updateIgnored: { "pkg-a": { version: "2.0.0", count: 2, until } },
		});
		expect(text).toContain('common.ignore.version:{"version":"2.0.0"}');
		expect(text).toContain("common.ignore.count");
		expect(text).toContain(new Date(until).toLocaleString());
		expect(text.split("common.ignore.separator").length - 1).toBe(2);
	});
});
