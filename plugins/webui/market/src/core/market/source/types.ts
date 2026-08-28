/**
 * 市场索引源的配置与 I/O 注入接口，以及市场侧路由统计的调参工厂。
 *
 * 关键设计决策：
 * - 遵循 core 层"禁 koishi 运行时"约定，HTTP、控制台刷新、补片广播等副作用
 *   全部经 `MarketSourceDeps` 构造注入（P3 的 MarketProvider 负责接线）。
 * - `createMarketRouteStatsBook` 集中承载市场侧端点统计调参（冷却阶梯、失败惩罚、
 *   rescue 降罚），供 source/index.ts 组装与 endpoints 测试共用，避免调参散落。
 */

import type { Dict } from "@koishi-ce/koishi";
import type { SearchObject } from "@koishi-ce/registry";
import type { MarketPerformance } from "../../../shared/types.js";
import { RouteStatsBook } from "../../racing/stats.js";
import type { MarketHttp } from "./fetch-endpoint.js";

/** 市场源行为配置（对应插件 config 的市场部分）。 */
export interface MarketSourceConfig {
	/** 用户配置的主端点 URL；缺省回填 DEFAULT_ENDPOINT */
	endpoint?: string | undefined;
	/** 请求超时（ms） */
	timeout?: number | undefined;
	/** 是否启用多镜像竞速路由；false 时只用主端点 */
	autoRoute?: boolean | undefined;
	/** 日志级别；为 debug 时快照才对外暴露性能信息 */
	logLevel?: string | undefined;
}

/** 市场源构造依赖：全部 I/O 经此注入，core 不接触 koishi 运行时。 */
export interface MarketSourceDeps {
	/** koishi HTTP 适配（按端点创建） */
	http: (endpoint: string) => MarketHttp;
	/** scanner 的 registry 元数据请求（接 ctx.http.get） */
	scannerRequest: (
		url: string,
		config?: { timeout?: number },
	) => Promise<unknown>;
	/** 磁盘缓存主清单路径 */
	cacheFile: string;
	/** 拆分条目目录路径 */
	cacheDir: string;
	log: {
		debug(message: string): void;
		info(message: string): void;
		warn(message: string): void;
	};
	/** console.refresh('market') 等价物 */
	notifyRefresh: () => Promise<unknown> | unknown;
	/** market/patch 广播（节流在适配层） */
	broadcastPatch: (payload: {
		data: Dict<SearchObject>;
		revision: number;
		total: number;
		progress: number;
		failed: number;
		debug?: MarketPerformance | undefined;
	}) => void;
	/** legacy 分析阶段把 registry 版本喂回 installer.setPackage */
	onRegistryVersions: (name: string, versions: unknown[]) => void;
}

/** 市场索引路由统计：乐观成功 + 阶梯冷却（旧 MarketProvider 的调参，成块移植）。 */
export function createMarketRouteStatsBook() {
	return new RouteStatsBook({
		fastThreshold: 500,
		successClamp: [-6, 3],
		failureClamp: [-10, 3],
		// 救援端点本就处于冷却中才被启用，失败不应再按全量惩罚扣分
		failurePenalty: (options) => (options.rescue ? 0.25 : 1.2),
		// 连续失败冷却阶梯：60s → 5m → 30m → 4h → 12h
		cooldown: (failures) =>
			failures <= 0
				? 0
				: failures === 1
					? 60_000
					: failures === 2
						? 300_000
						: failures === 3
							? 1_800_000
							: failures === 4
								? 14_400_000
								: 43_200_000,
		roundAverage: false,
		trackFailureMeta: false,
	});
}
