/**
 * @file console listener 的聚合注册入口。
 *
 * 模块职责:按 install(安装/卸载/合包)、upload(本地上传)、market
 * (查询/配置/头像)三组拆分注册,本函数只负责把依赖(config、dataStore、
 * snapshot transport)分发给各组。
 *
 * 架构位置:node 适配层 console/listeners,由 setup.ts 在插件 apply 时
 * 调用一次。
 */
import type { Context } from "@koishi-ce/koishi";
import type { Config } from "../../config/index.js";
import type { MarketDataStore } from "../../market/data-store.js";
import type { MarketSnapshotTransport } from "../../market/snapshot-transport.js";
import { registerInstallListeners } from "./install.js";
import { registerMarketListeners } from "./market.js";
import { registerUploadListeners } from "./upload.js";

/** 注册全部 market/* console listener（按 install/upload/market 三组拆分）。 */
export function registerListeners(
	ctx: Context,
	config: Config,
	dataStore: MarketDataStore,
	marketSnapshotTransport: MarketSnapshotTransport,
) {
	registerInstallListeners(ctx, dataStore);
	registerUploadListeners(ctx);
	registerMarketListeners(ctx, config, dataStore, marketSnapshotTransport);
}
