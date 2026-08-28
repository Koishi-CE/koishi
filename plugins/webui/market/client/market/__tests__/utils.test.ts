import { describe, expect, it, vi } from "vitest";

/**
 * @file market 域工具聚合出口(utils.ts)的单元测试。
 *
 * 走真实聚合链(avatar/users/context/catalog/sort/filter 的 re-export),
 * mock @koishi-ce/client 提供最小 composer 支撑 shared/i18n 装配。
 * 验证导出面与各子模块逐一同一(identity),防止聚合出口漏转发出错。
 */

const client = vi.hoisted(() => ({
	send: vi.fn(),
	receive: vi.fn(),
	store: {} as any,
}));

vi.mock("@koishi-ce/client", () => ({
	send: client.send,
	receive: client.receive,
	store: client.store,
	useI18n: () => ({
		t: (key: string) => key,
		locale: { value: "zh-CN" },
		getLocaleMessage: () => ({}),
		mergeLocaleMessage: () => {},
		setLocaleMessage: () => {},
	}),
}));

describe("utils 聚合出口", () => {
	it("re-export 的符号与各子模块逐一同一", async () => {
		const utils = await import("../utils");
		const avatar = await import("../avatar");
		const catalog = await import("../catalog");
		const context = await import("../context");
		const filter = await import("../filter");
		const sort = await import("../sort");
		const users = await import("../users");

		expect(utils.getUserAvatarCandidates).toBe(avatar.getUserAvatarCandidates);
		expect(utils.getCachedAvatarFromCandidates).toBe(
			avatar.getCachedAvatarFromCandidates,
		);
		expect(utils.cacheAvatarFailure).toBe(avatar.cacheAvatarFailure);
		expect(utils.isAvatarFailureCached).toBe(avatar.isAvatarFailureCached);
		expect(utils.fetchAndCacheAvatar).toBe(avatar.fetchAndCacheAvatar);
		expect(utils.fetchCachedAvatar).toBe(avatar.fetchCachedAvatar);
		expect(utils.getUserKey).toBe(users.getUserKey);
		expect(utils.getUsers).toBe(users.getUsers);
		expect(utils.formatShortname).toBe(context.formatShortname);
		expect(utils.isPluginPackage).toBe(context.isPluginPackage);
		expect(utils.kConfig).toBe(context.kConfig);
		expect(utils.badges).toBe(catalog.badges);
		expect(utils.categories).toBe(catalog.categories);
		expect(utils.isBundleSearchObject).toBe(catalog.isBundleSearchObject);
		expect(utils.canInstallBundleSearchObject).toBe(
			catalog.canInstallBundleSearchObject,
		);
		expect(utils.resolveCategory).toBe(catalog.resolveCategory);
		expect(utils.comparators).toBe(sort.comparators);
		expect(utils.getSortedPrepared).toBe(sort.getSortedPrepared);
		expect(utils.getFiltered).toBe(filter.getFiltered);
		expect(utils.getSilentFiltered).toBe(filter.getSilentFiltered);
		expect(utils.getVisible).toBe(filter.getVisible);
		expect(utils.hasFilter).toBe(filter.hasFilter);
		expect(utils.parseSilentFilters).toBe(filter.parseSilentFilters);
		expect(utils.validate).toBe(filter.validate);
		expect(utils.validateWord).toBe(filter.validateWord);
	});

	it("聚合链上的真实 i18n 装配可用(useMarketI18n 走真实链路)", async () => {
		const utils = await import("../utils");
		const { t } = utils.useMarketI18n();
		expect(t("title")).toBe("marketNext.market.title");
	});

	it("纯函数经聚合出口调用行为一致", async () => {
		const utils = await import("../utils");
		expect(utils.resolveCategory("adapter")).toBe("adapter");
		expect(utils.resolveCategory("bogus")).toBe("other");
		expect(utils.isPluginPackage("koishi-plugin-foo")).toBe(true);
		expect(utils.hasFilter(["sort:download"])).toBe(false);
	});
});
