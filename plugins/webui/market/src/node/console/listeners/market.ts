/**
 * @file 市场查询/配置类 console listener(market 域)。
 *
 * 模块职责:
 * - 纯转发类:环境快照查询/预览、合包配置移除、配置与数据补丁、单包
 *   registry 元数据、补建插件配置等,直接桥到对应模块;
 * - 有编排的:环境快照应用(装完刷新三通道)、依赖刷新、market/index
 *   快照下发(http-gzip 走 MarketSnapshotTransport)、market/lookup、
 *   market/registry 批量元数据、market/avatar 头像抓取。
 *
 * 关键设计:
 * - market/index 按 client 请求的 transport 决定下发形态:默认整快照,
 *   http-gzip 时返回传输描述,由前端再走 HTTP 路由拉 gzip body;
 * - market/registry 批量取元数据按 installer 并发上限 p-map,单包失败
 *   只记 debug 并跳过,不让整批失败;
 * - market/avatar 失败返回 undefined:头像缺失在前端只是留白。
 *
 * 架构位置:node 适配层 console/listeners,由 listeners/index.ts 聚合注册。
 */
import type { Context } from "@koishi-ce/koishi";
import pMap from "p-map";
import type { PackageVersions } from "../../../core/registry/cache/index.js";
import type {
	MarketLookupRequest,
	MarketSnapshotRequest,
	MarketSnapshotResponse,
} from "../../../shared/types.js";
import { fetchAvatar } from "../../avatar/index.js";
import type { Config } from "../../config/index.js";
import { updateMarketNextConfig } from "../../config/manage.js";
import { ensurePluginConfig } from "../../config/plugin-configs.js";
import { removeBundleConfigs } from "../../market/bundle.js";
import type { MarketDataStore } from "../../market/data-store.js";
import type { MarketProvider } from "../../market/index.js";
import type { MarketSnapshotTransport } from "../../market/snapshot-transport.js";
import { assertContract } from "../contracts.js";
import { lookupMarket } from "../lookup.js";
import {
	refreshConsole,
	registerContractListener,
	registerContractListeners,
} from "./helpers.js";

/** 市场查询/配置类 listener：环境快照、配置与数据补丁、索引查询、头像。 */
export function registerMarketListeners(
	ctx: Context,
	config: Config,
	dataStore: MarketDataStore,
	marketSnapshotTransport: MarketSnapshotTransport,
) {
	registerContractListeners(ctx, {
		"market/environment-snapshots": () =>
			ctx.installer.getEnvironmentSnapshots(),
		"market/environment-snapshot-preview": (id) =>
			ctx.installer.getEnvironmentSnapshotPreview(id),
		"market/remove-bundle-configs": (request) =>
			removeBundleConfigs(ctx, request),
		"market/update-config": (patch) =>
			updateMarketNextConfig(ctx, config, patch),
		"market/update-data": (patch) => dataStore.patch(patch),
		"market/package": (name) => ctx.installer.getRegistry(name),
		"market/ensure-config": (name) => ensurePluginConfig(ctx, name),
	});

	// 环境快照应用 = 按快照重装依赖:完成后刷新依赖/registry/插件列表三通道
	ctx.console.addListener(
		"market/environment-snapshot-apply",
		async (id, options) => {
			assertContract("market/environment-snapshot-apply", id, options);
			const code = await ctx.installer.applyEnvironmentSnapshot(id, options);
			await refreshConsole(ctx, ["dependencies", "registry", "packages"]);
			return code;
		},
		{ authority: 4 },
	);

	registerContractListener(ctx, "market/refresh-dependencies", async () => {
		await ctx.installer.refresh(true);
		await ctx.get("console")?.refresh("config");
	});

	registerContractListener(
		ctx,
		"market/index",
		async (request: MarketSnapshotRequest | undefined) => {
			const snapshot = await ctx.console.services.market?.getSnapshot?.();
			// client 未要求 http-gzip(或不支持)时,直接内联整份快照返回
			if (!snapshot || request?.transport !== "http-gzip")
				return snapshot as MarketSnapshotResponse;
			return marketSnapshotTransport.create(snapshot);
		},
	);

	registerContractListener(
		ctx,
		"market/lookup",
		(request: MarketLookupRequest | undefined) =>
			lookupMarket(
				ctx.console.services.market as MarketProvider | undefined,
				request,
			),
	);

	registerContractListener(ctx, "market/registry", async (names: string[]) => {
		// 批量取元数据:失败的单包跳过(前端按缺失处理),并发走 installer 配置
		const entries = await pMap(
			names,
			async (name) => {
				try {
					const meta = await ctx.installer.getPackage(name);
					if (!meta) return;
					return [name, meta] as const;
				} catch (error) {
					ctx
						.logger("market")
						.debug(
							`skip registry metadata for ${name}: ${error instanceof Error ? error.message : error}`,
						);
				}
				return;
			},
			{ concurrency: ctx.installer.config.concurrency ?? 4 },
		);
		return Object.fromEntries(
			entries.filter(
				(entry): entry is readonly [string, PackageVersions] => !!entry,
			),
		);
	});

	registerContractListener(
		ctx,
		"market/avatar",
		async (key: string, url?: string) => {
			try {
				return await fetchAvatar(ctx, key, url);
			} catch (error) {
				// 头像抓取失败仅记 debug:前端按无头像展示,不值得告警
				ctx
					.logger("market")
					.debug(
						`avatar fetch failed: ${error instanceof Error ? error.message : error}`,
					);
			}
			return undefined;
		},
	);
}
