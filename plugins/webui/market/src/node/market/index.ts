import { resolve } from "node:path";
import { type Context, Schema, Time } from "@koishi-ce/koishi";
import type { RemotePackage } from "@koishi-ce/registry";
import { DEFAULT_ENDPOINT } from "../../core/market/source/endpoints.js";
import type { MarketHttp } from "../../core/market/source/fetch-endpoint.js";
import {
	MarketIndexSource,
	type MarketSourceDeps,
} from "../../core/market/source/index.js";
import { formatError } from "../../core/utils/format.js";
import { MarketProvider as BaseMarketProvider } from "../../shared/provider.js";

const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;

/** 按 logLevel 门控的市场日志（debug 级别时镜像为 info，旧 MarketProvider.log 行为）。 */
function createMarketLogger(ctx: Context, config: MarketProviderConfig) {
	const logger = ctx.logger("market");
	const level = config.logLevel ?? "warn";
	const enabled = (target: (typeof LOG_LEVELS)[number]) =>
		LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(target);
	return {
		debug: (message: string) => {
			if (enabled("debug")) logger.info(`[debug] ${message}`);
		},
		info: (message: string) => {
			if (enabled("info")) logger.info(message);
		},
		warn: (message: string) => {
			if (enabled("warn")) logger.warn(message);
		},
	};
}

/** 按端点创建 MarketHttp（text 解码 + 响应头透传）。 */
function createMarketHttp(ctx: Context, config: MarketProviderConfig) {
	return (endpoint: string): MarketHttp => {
		const client = ctx.http.extend({
			endpoint,
			...(config.timeout === undefined ? {} : { timeout: config.timeout }),
		});
		return {
			getText: async (path, cfg) => {
				const response = await client(path, {
					responseType: "text",
					headers: cfg.headers,
					signal: cfg.signal,
					validateStatus: cfg.validateStatus,
				});
				return {
					status: response.status,
					data: response.data,
					headers: response.headers,
				};
			},
		};
	};
}

/**
 * market 通道的 node 实现：包装 MarketIndexSource，实现 DataService 的 get() 与快照。
 * 竞速/缓存/后台刷新主体都在 core 的 MarketIndexSource 内。
 */
export class MarketProvider extends BaseMarketProvider {
	private readonly source: MarketIndexSource;

	constructor(ctx: Context, config: MarketProviderConfig = {}) {
		super(ctx);
		this.source = new MarketIndexSource(this.createDeps(ctx, config), {
			endpoint: config.endpoint,
			timeout: config.timeout,
			autoRoute: config.autoRoute,
			logLevel: config.logLevel,
		});
		ctx.effect(
			() => () => this.source.scope.dispose("market provider disposed"),
		);
		ctx.on("ready", () => void this.source.warmDiskCache("startup"));
	}

	private createDeps(
		ctx: Context,
		config: MarketProviderConfig,
	): MarketSourceDeps {
		const log = createMarketLogger(ctx, config);
		const broadcastPatch = ctx.throttle(
			(payload: Parameters<MarketSourceDeps["broadcastPatch"]>[0]) => {
				void ctx.console.broadcast("market/patch", payload);
			},
			500,
		);
		return {
			http: createMarketHttp(ctx, config),
			scannerRequest: (url, cfg) => ctx.http.get(url, cfg),
			cacheFile: resolve(ctx.baseDir, "cache", "market-next-index.json"),
			cacheDir: resolve(ctx.baseDir, "cache", "market-next-index"),
			log,
			notifyRefresh: () => ctx.console.refresh("market"),
			broadcastPatch: (payload) => broadcastPatch(payload),
			onRegistryVersions: (name, versions) =>
				ctx.installer.setPackage(name, versions as RemotePackage[]),
		};
	}

	override async start(refresh = false) {
		await this.source.start(refresh);
	}

	/** DataService 通道 payload：不带 data（data 走 market/index RPC）。 */
	override async get() {
		const source = this.source;
		const current = source.payloadValue;
		return {
			registry: current?.registry || source.endpoint || source.config.endpoint,
			failed: current?.failed ?? source.failedCount(),
			total: source.scanner.total,
			progress: source.scanner.progress,
			gravatar: process.env["GRAVATAR_MIRROR"],
			stale: current?.stale ?? false,
			error:
				current?.error ??
				(source.error ? formatError(source.error) : undefined),
			cached: current?.cached ?? source.cacheMetaPresent,
			cachedAt: current?.cachedAt,
			validatedAt: current?.validatedAt,
			serverNow: Date.now(),
			refreshing: !!source.backgroundTask,
			loading: !source.hasCurrentData() && !source.error,
			revision: source.revisionValue,
			dataVersion: source.dataVersionValue,
			debug: source.exportedDebug(),
		};
	}

	getSnapshot() {
		return this.source.getSnapshot();
	}

	override probeInBackground(reason?: string) {
		return this.source.probeInBackground(reason ?? "idle probe");
	}
}

export interface MarketProviderConfig {
	endpoint?: string;
	timeout?: number;
	proxyAgent?: string;
	autoRoute?: boolean;
	logLevel?: "silent" | "error" | "warn" | "info" | "debug";
}

export const MarketProviderConfig: Schema<MarketProviderConfig> = Schema.object(
	{
		endpoint: Schema.string().role("link").default(DEFAULT_ENDPOINT),
		timeout: Schema.number()
			.role("time")
			.default(Time.second * 30),
		proxyAgent: Schema.string().role("link"),
		autoRoute: Schema.boolean().default(true),
		logLevel: Schema.union(
			LOG_LEVELS.map((level) => Schema.const(level)),
		).default("warn"),
	},
);
