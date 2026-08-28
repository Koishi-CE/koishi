/**
 * @koishi-ce/plugin-marketn 插件入口（src/node 适配层的最外层）。
 *
 * 职责：只做「装配」——按依赖就绪顺序把 Installer 服务、3 个 registry/依赖
 * DataService、市场源（MarketProvider 含 market 通道）、console 前端入口、
 * 市场快照 HTTP 路由、4 个命令与 25 个 RPC listener 挂到宿主 Koishi 上；
 * 业务逻辑全部下沉 src/core，本文件不含任何业务实现。
 *
 * 关键设计：
 * - apply 最先校验 ctx.loader 可写：本插件需要改写 package.json 与 Koishi 配置文件，
 *   非 json/yaml 配置宿主上这些写入全部失效，直接告警短路。
 * - 分两段 ctx.inject：命令层只依赖 installer；console/server 相关部件等两个服务
 *   都就绪后再挂载（快照 HTTP 路由必须等 server）。
 * - MarketDataStore 通过 active 引用登记当前活跃实例：命令层（无 console 依赖）
 *   经 getDataStore() 间接取用，避免命令层反向注入 console。
 *
 * 架构位置：宿主 koishi.yml 加载本文件；装配细节下沉 setup.ts，console 服务与
 * listener 在 console/*，市场源与数据存储在 market/*；前端 client/ 经
 * ctx.console.addEntry 接入。文件前半的 type/export 转发是包的公共类型面
 * （core/shared 类型随 ./shared 与本入口对宿主可见）。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@koishi-ce/koishi";
import "./declarations.js";
import type { Config } from "./config/index.js";
import { registerCommands } from "./console/commands.js";
import { registerListeners } from "./console/listeners/index.js";
import {
	DependencyProvider,
	RegistryProvider,
	RegistryStatusProvider,
} from "./console/providers.js";
import { Installer } from "./installer/index.js";
import type { MarketDataStore } from "./market/data-store.js";
import { setupIdleProbe } from "./market/idle-probe.js";
import { MarketProvider } from "./market/index.js";
import {
	createDataStore,
	normalizeConfigDefaults,
	setupReadyTasks,
	setupSnapshotRoute,
} from "./setup.js";

/**
 * 解析前端产物在宿主 node_modules 下的可达路径（console 静态服务安全检查用）。
 *
 * console 的 serveAssets 对 /@plugin-* 请求做 403 防护：解析后的文件路径必须
 * 落在 console 自身 dist 内或包含 "node_modules"。workspace junction 场景下
 * __filename/import.meta.url 会被 realpath 成 external/... 真实路径，直接
 * resolve(here, "../../dist") 得到的路径不含 node_modules 而被 403 拦截；
 * 这里从当前目录向上找宿主 node_modules 里的 <包名> 链接（junction 或 npm
 * 安装点），npm 安装场景第一轮即可命中。
 */
function resolveConsoleClientRoot(here: string, packageName: string): string {
	let dir = here;
	for (;;) {
		const candidate = join(dir, "node_modules", packageName);
		if (existsSync(candidate)) {
			// console 的 resolveEntry 会向 prod 路径追加 /index.js，因此这里
			// 必须返回 dist 目录本身（而非包根）。
			const dist = join(candidate, "dist");
			if (existsSync(dist)) return dist;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return resolve(here, "../../dist");
}

export type {
	EnvironmentChangeStatus,
	EnvironmentSnapshotChange,
	EnvironmentSnapshotPreview,
} from "../core/environment/diff.js";
export type {
	EnvironmentDependencySnapshot,
	EnvironmentSnapshotSource,
	EnvironmentSnapshotSummary,
} from "../core/environment/snapshot.js";
export type {
	InstallHistoryChange,
	InstallHistoryEntry,
	InstallHistoryStatus,
	InstallLogDetail,
	LocalBindingResult,
} from "../core/install/types.js";
export type {
	LocalPackageOperation,
	LocalPackageUploadChunkRequest,
	LocalPackageUploadCommitResult,
	LocalPackageUploadFinishRequest,
	LocalPackageUploadPreview,
	LocalPackageUploadProgress,
	LocalPackageUploadStartRequest,
	LocalPackageUploadStartResult,
} from "../core/upload/types.js";
export * from "../shared/index.js";
export { Config } from "./config/index.js";
export { Installer } from "./installer/index.js";

/** 插件名（沿用旧版市场插件的 market 标识）。 */
export const name = "market";
/** 直接依赖仅 http；installer / console / server 用 ctx.inject 惰性等待就绪。 */
export const inject = ["http"];

/** 控制台配置页顶部展示的使用说明（内置社区镜像端点清单，供用户填配置参考）。 */
export const usage = `
如果插件市场页面提示「无法连接到插件市场」，则可以选择一个 Koishi 社区提供的镜像地址，填入下方对应的配置项中。

## 插件市场（填入 search.endpoint）

- Koishi（全球）：https://registry.koishi.chat/index.json
- [Gitee 聚合](https://k.ilharp.cc/4000)（大陆）：https://gitee.com/shangxueink/koishi-registry-aggregator/raw/gh-pages/market.json
- [t4wefan](https://k.ilharp.cc/2611)（大陆）：https://registry.koishi.t4wefan.pub/index.json
- [Lipraty](https://k.ilharp.cc/3530)（大陆）：https://koi.nyan.zone/registry/index.json
- [itzdrli](https://k.ilharp.cc/9975)（全球）：https://kp.itzdrli.cc
- itzdrli 备用：https://koishi.itzdrli.cc
- Koishi Registry GitHub Pages：https://koishijs.github.io/registry/index.json
- Koishi Registry GitHub Raw：https://raw.githubusercontent.com/koishijs/registry/release/index.json
- Koishi Registry jsDelivr：https://cdn.jsdelivr.net/gh/koishijs/registry@release/index.json
- Koishi Registry GitHub 代理：https://ghproxy.net/https://raw.githubusercontent.com/koishijs/registry/release/index.json
- Koishi Registry GitHub 代理 2：https://ghfast.top/https://raw.githubusercontent.com/koishijs/registry/release/index.json

要浏览更多社区镜像，请访问 [Koishi 论坛上的镜像一览](https://k.ilharp.cc/4000)。`;

// npm 软件源镜像参考（填入 registry.endpoint；参考底册中同样以注释形态保留、不对用户展示）：
// 淘宝（大陆）https://registry.npmmirror.com / 腾讯（大陆）https://mirrors.cloud.tencent.com/npm
// 华为云（大陆）https://mirrors.huaweicloud.com/repository/npm / npm（全球）https://registry.npmjs.org / cnpm https://r.cnpmjs.org

/**
 * 插件 apply 主流程：校验宿主可写 → 归一化配置缺省 → 挂 Installer 服务 →
 * 分别在 installer / console+server 就绪后装配命令层与 console 前后端。
 */
export function apply(ctx: Context, config: Config = {}) {
	// 本插件要写 package.json 与 Koishi 配置文件，只支持 json/yaml 配置宿主
	if (!ctx.loader?.writable) {
		return ctx
			.logger("app")
			.warn(
				"@koishi-ce/plugin-marketn is only available for json/yaml config file",
			);
	}

	normalizeConfigDefaults(ctx, config);

	// 活跃 MarketDataStore 引用：console 分支创建并登记，命令层经 getDataStore 读取，
	// 插件卸载时由 setup 里的 effect 清空
	const active: { dataStore?: MarketDataStore | undefined } = {};
	const getDataStore = () => active.dataStore;

	// installer 是命令层与 console 层的共同依赖，先挂载；配置取 registry 分节
	ctx.plugin(Installer, config.registry ?? {});

	ctx.inject(["installer"], (ctx) => {
		registerCommands(ctx, config, getDataStore);
	});

	// console 相关装配：providers → 数据存储/市场源/空闲探测 → 前端入口 →
	// 快照 HTTP 路由 → RPC listener → ready 阶段任务
	ctx.inject(["console", "installer", "server"], (ctx) => {
		ctx.plugin(DependencyProvider);
		ctx.plugin(RegistryProvider);
		ctx.plugin(RegistryStatusProvider);
		const dataStore = createDataStore(ctx, active);
		ctx.plugin(MarketProvider, config.search ?? {});
		setupIdleProbe(ctx, config);

		// 注册前端入口：dev 指向 client 源码（宿主内置 vite 代为编译），
		// prod 指向本包构建产物 dist/。prod 不能直接用 resolve(here, "../../dist")：
		// console 的 /@plugin-* 静态服务在生产模式只放行 node_modules 内或 console
		// dist 内的文件（serveAssets 的 403 安全检查），而 workspace（external/）
		// junction 场景下 __filename 会被 realpath 成真实路径，external/.../dist
		// 不含 node_modules 会被 403 拦截，导致插件前端页面无法加载。这里向上找到
		// 宿主 node_modules 里的本包链接作为 prod 根（npm 安装场景同样命中）。
		const here = dirname(fileURLToPath(import.meta.url));
		const require = createRequire(fileURLToPath(import.meta.url));
		const packageName = require("../../package.json").name as string;
		ctx.console.addEntry({
			dev: resolve(here, "../../client/index.ts"),
			prod: resolveConsoleClientRoot(here, packageName),
		});

		const marketSnapshotTransport = setupSnapshotRoute(ctx);
		// 卸载时同步注销 koa 路由与传输缓存，避免路由悬空
		ctx.effect(() => () => marketSnapshotTransport.clear());

		registerListeners(ctx, config, dataStore, marketSnapshotTransport);
		setupReadyTasks(ctx, config, dataStore);
	});
}
