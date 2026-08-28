/**
 * apply 阶段的初始化装配辅助：配置缺省归一化、MarketDataStore 创建与活跃登记、
 * 市场快照 HTTP 路由挂载、ready 阶段一次性任务（数据迁移 / 配置补齐 / 头像缓存清扫）。
 *
 * 设计定位：index.ts 只决定「何时挂什么」，具体「怎么挂」收敛在此，便于单独审查
 * 各装配步骤的生命周期（effect 清理、ready 时机、落盘失败容错）。
 * 快照路由用结构化最小的 KoaContextLike 描述 koa 上下文，避免为本文件引入
 * koa 类型依赖；server 服务由 index.ts 的 inject(["server"]) 保证可用。
 */
import type { Context } from "@koishi-ce/koishi";
import {
	AVATAR_CACHE_SWEEP_INTERVAL,
	cleanupAvatarCaches,
	clearAvatarMemoryCache,
} from "./avatar/index.js";
import type { Config } from "./config/index.js";
import {
	ensureMarketNextConfigDefaults,
	removeLegacyCollapsedGroupsConfig,
} from "./config/manage.js";
import { ensureInstalledPluginConfigs } from "./config/plugin-configs.js";
import { MarketDataStore } from "./market/data-store.js";
import { MarketSnapshotTransport } from "./market/snapshot-transport.js";

/** 归一化显示配置缺省值并落盘刷新（失败只记日志）。 */
export function normalizeConfigDefaults(ctx: Context, config: Config) {
	// 未发生任何补齐时跳过落盘，避免无谓的配置文件重写
	if (!ensureMarketNextConfigDefaults(ctx, config)) return;
	ctx
		.logger("market")
		.info("normalized market-next display config in Koishi config");
	void ctx.loader
		.writeConfig(true)
		.then(() => ctx.get("console")?.refresh("config"))
		.catch((error) => ctx.logger("market").warn(error));
}

/** 创建 DataStore 并登记激活引用（同一时刻只有一个活跃实例）。 */
export function createDataStore(
	ctx: Context,
	active: { dataStore?: MarketDataStore | undefined },
): MarketDataStore {
	const dataStore = new MarketDataStore(ctx);
	active.dataStore = dataStore;
	// 卸载时清引用；先比对再清空，防止热重载后新实例被旧 effect 误清
	ctx.effect(() => () => {
		if (active.dataStore === dataStore) active.dataStore = undefined;
	});
	return dataStore;
}

/** 市场快照路由 handler 所需的 koa 上下文最小结构。 */
interface KoaContextLike {
	params: { id: string };
	status: number;
	body: unknown;
	type: string;
	set(name: string, value: string): void;
}

/** 挂载市场快照 HTTP 路由（gzip + 强缓存 + ETag）。 */
export function setupSnapshotRoute(ctx: Context): MarketSnapshotTransport {
	// uiPath 可能带尾部斜杠，统一去掉保证路由拼接唯一
	const uiPath = String(
		(ctx.console as unknown as { config?: { uiPath?: string } }).config
			?.uiPath ?? "",
	).replace(/\/+$/, "");
	const marketSnapshotRoute = `${uiPath}/market-next/snapshot`;
	const marketSnapshotTransport = new MarketSnapshotTransport(
		ctx,
		marketSnapshotRoute,
	);
	// server 由 inject 保证存在；用最小结构类型代替 koa 依赖
	const server = (ctx as Context & { server: unknown }).server as {
		get(path: string, handler: (koa: KoaContextLike) => void): void;
	};
	server.get(`${marketSnapshotRoute}/:id`, (koa: KoaContextLike) => {
		const entry = marketSnapshotTransport.get(koa.params.id);
		if (!entry) {
			// 传输层只保留最近若干条快照，过期 id 直接 404（客户端会回退 inline 传输）
			koa.status = 404;
			koa.body = "market snapshot not found";
			return;
		}
		koa.type = "application/json";
		// 快照 id 即内容 hash，内容不可变，可安全使用一年期 immutable 强缓存
		koa.set("Content-Encoding", "gzip");
		koa.set("Cache-Control", "public, max-age=31536000, immutable");
		koa.set("ETag", `"${entry.id}"`);
		koa.set("X-Content-Type-Options", "nosniff");
		koa.body = entry.body;
	});
	return marketSnapshotTransport;
}

/** ready 阶段任务：数据迁移、配置补齐、头像缓存清扫（含定时器清理）。 */
export function setupReadyTasks(
	ctx: Context,
	config: Config,
	dataStore: MarketDataStore,
) {
	ctx.on("ready", () => {
		void dataStore
			.migrateFromConfig(config)
			.then(() => {
				if (!removeLegacyCollapsedGroupsConfig(ctx, config)) return;
				return ctx.loader
					.writeConfig(true)
					.then(() => ctx.get("console")?.refresh("config"));
			})
			.catch((error) =>
				ctx
					.logger("market")
					.warn(
						`failed to migrate market-next data: ${error instanceof Error ? error.message : error}`,
					),
			);
		const timer = setTimeout(() => {
			if (!ctx.scope.isActive) return;
			void ensureInstalledPluginConfigs(ctx).catch((error) =>
				ctx.logger("market").warn(error),
			);
		}, 1000);
		void cleanupAvatarCaches(ctx);
		const avatarTimer = setInterval(
			() => cleanupAvatarCaches(ctx),
			AVATAR_CACHE_SWEEP_INTERVAL,
		);
		ctx.effect(() => () => {
			clearTimeout(timer);
			clearInterval(avatarTimer);
			clearAvatarMemoryCache();
		});
	});
}
