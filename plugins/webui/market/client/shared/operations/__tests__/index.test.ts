import { describe, expect, it, vi } from "vitest";

/**
 * @file operations 域聚合出口的测试:保证拆分后的 re-export 面
 * 与拆分前的单文件导出一致,消费方按符号名导入均可用。
 * 聚合出口会拉起 install/plugin-config 等完整依赖链,宿主照例 mock。
 */

vi.mock("@koishi-ce/client", async () => {
	const { createKoishiClientStub } = await import("../../__tests__/helpers");
	return createKoishiClientStub();
});

vi.mock("../../i18n", () => ({
	translate: (key: string) => key,
}));

const operations = await import("../index");

describe("shared/operations 聚合出口", () => {
	it("安装编排与进度面板", () => {
		for (const name of [
			"install",
			"applyEnvironmentSnapshot",
			"prepareInstallFallbackRetry",
			"resetInstallFallbackState",
			"installProgressState",
		]) {
			expect(operations).toHaveProperty(name);
		}
		expect(operations.install).toBeTypeOf("function");
		expect(operations.installProgressState).toBeTypeOf("object");
	});

	it("配置就绪等待与依赖分析", () => {
		for (const name of [
			"ensureInstalledConfig",
			"ensureInstalledConfigs",
			"analyzeVersions",
			"getRegistryStatus",
			"getRegistryStatusText",
		]) {
			expect(operations[name]).toBeTypeOf("function");
		}
	});

	it("合包记录族与共享状态", () => {
		for (const name of [
			"createLocalBundleRecord",
			"fetchBundleRecord",
			"getBundleMemberConfigState",
			"resolveBundlePackageFromGroup",
			"resolveBundleRecordFromGroup",
			"addManual",
			"getConfigWriter",
		]) {
			expect(operations[name]).toBeTypeOf("function");
		}
		for (const name of [
			"activeBundle",
			"expandedDependency",
			"pendingBundleUninstalls",
			"showConfirm",
			"showEnvironmentVersions",
			"showInstallHistory",
			"showManual",
			"MARKET_NEXT_PACKAGE",
		]) {
			expect(operations).toHaveProperty(name);
		}
	});
});
