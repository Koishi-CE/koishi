/**
 * @file 聊天侧命令:plugin.install / uninstall / upgrade / clear-avatar-cache。
 *
 * 模块职责:注册四个 authority 4 的机器人命令,把命令行操作桥接到
 * installer(与 console RPC 走同一套 core 编排,保证行为一致);升级命令
 * 完整流程为刷新元数据 -> 按更新忽略策略筛选目标 -> 展示清单并等待
 * 确认 -> envData.message 定向回执安装结果。
 *
 * 关键设计:安装/升级前把 session 信息写进 loader.envData.message,
 * fullReload 后新进程据此回到原频道回报结果(finally 里务必清空);
 * 升级目标计算与 console 侧共用 shared/update 策略;卸载直接传
 * { name: null } 给 install:core 编排里 null 版本即删除。
 *
 * 架构位置:node 适配层 console 模块,由 setup.ts 在插件 apply 时调用。
 */
import { type Context, type Dict, pick, type Session } from "@koishi-ce/koishi";
import type { Dependency } from "../../core/deps/types.js";
import {
	getLatestAllowedUpdate,
	getUpdateCandidates,
	type UpdateIgnorePolicy,
} from "../../shared/update.js";
import { clearAvatarCacheStorage } from "../avatar/index.js";
import type { Config } from "../config/index.js";
import { ensurePluginConfigs } from "../config/plugin-configs.js";
import { messageEn, messageZh } from "../locales/generated.js";
import {
	type MarketDataStore,
	readMarketDataStore,
} from "../market/data-store.js";

/** 解析命令参数并返回已在依赖中的候选名（install/uninstall 共用）。 */
async function findInstalledName(
	ctx: Context,
	name: string,
): Promise<string | undefined> {
	const names = ctx.installer.resolveName(name);
	const deps = (await ctx.installer.getDeps()) ?? {};
	return names.find((candidate) => deps[candidate]);
}

/** 待升级条目:包名、当前已装版本(resolved)与目标版本。 */
interface UpgradeTarget {
	name: string;
	resolved: string;
	target: string;
}

/** 计算单个依赖的升级目标:无更高版本时返回空数组。 */
function resolveUpgradeTarget(
	ctx: Context,
	name: string,
	dep: Dependency,
	resolved: string,
	force: boolean,
	policy: UpdateIgnorePolicy,
	now: number,
): UpgradeTarget[] {
	const versions = Object.keys(ctx.installer.fullCache[name] ?? {});
	// 缓存还没灌满时至少用 dep.latest 兜底,避免漏掉可升级项
	if (!versions.length && dep.latest) versions.push(dep.latest);
	const target = force
		? getUpdateCandidates(versions, resolved)[0]
		: getLatestAllowedUpdate(name, versions, resolved, policy, now);
	return target ? [{ name, resolved, target }] : [];
}

/** 依据更新策略计算可升级的依赖列表（update ignore 策略 + force 覆盖）。 */
async function collectUpgradeTargets(
	ctx: Context,
	config: Config,
	deps: Dict<Dependency>,
	requested: string[],
	force: boolean,
	getDataStore: () => MarketDataStore | undefined,
	now: number,
): Promise<UpgradeTarget[]> {
	const dataStore = getDataStore();
	const runtimeData = dataStore
		? await dataStore.get()
		: await readMarketDataStore(ctx);
	const policy: UpdateIgnorePolicy = {
		updateIgnoredPackages: config.updateIgnoredPackages,
		updateIgnoreVersions: config.updateIgnoreVersions,
		updateIgnorePrerelease: config.updateIgnorePrerelease,
		updateIgnored: runtimeData.updateIgnored,
	};
	return Array.from(new Set(requested)).flatMap((name) => {
		// 本地/workspace/invalid 依赖不参与升级:它们不走 registry 版本语义
		const dep = deps[name];
		if (!dep?.resolved || dep.local || dep.workspace || dep.invalid) return [];
		return resolveUpgradeTarget(
			ctx,
			name,
			dep,
			dep.resolved,
			force,
			policy,
			now,
		);
	});
}

/** 展示待升级清单并等待用户确认。 */
async function confirmUpgrade(
	session: Session,
	updates: UpgradeTarget[],
): Promise<boolean> {
	const output = updates.map(
		({ name, resolved, target }) => `${name}: ${resolved} -> ${target}`,
	);
	output.unshift(session.text(".available"));
	output.push(session.text(".prompt"));
	await session.send(output.join("\n"));
	const result = await session.prompt();
	return result != null && ["Y", "y"].includes(result.trim());
}

/** 执行升级安装，返回包管理器退出码（0 为成功）。 */
async function performUpgrade(
	ctx: Context,
	session: Session,
	updates: UpgradeTarget[],
): Promise<number | undefined> {
	ctx.loader.envData.message = {
		// 记录来源会话:fullReload 后新进程据此把"安装成功"回到原频道
		...pick(session, ["sid", "channelId", "guildId", "isDirect"]),
		content: session.text(".success"),
	};
	const installNames = updates.map((update) => update.name);
	const installDeps = updates.reduce<Dict<string>>((result, update) => {
		result[update.name] = update.target;
		return result;
	}, {});
	try {
		const code = await ctx.installer.install(installDeps, undefined, () =>
			ensurePluginConfigs(ctx, installNames),
		);
		// beforeReload 回调之外再补一次:覆盖安装未触发 reload 的场景
		if (!code) await ensurePluginConfigs(ctx, installNames);
		return code;
	} finally {
		// 无论成败都清掉定向回执,避免影响后续 fullReload
		ctx.loader.envData.message = null;
	}
}

/** plugin.install 命令体:校验入参 → 查已装 → 解析版本 → 安装并定向回执。 */
async function runInstallCommand(
	ctx: Context,
	session: Session | undefined,
	name: string | undefined,
) {
	if (!session) return;
	if (!name) return session.text(".expect-name");
	const installed = await findInstalledName(ctx, name);
	if (installed) return session.text(".already-installed");

	const result = await ctx.installer.findVersion(
		ctx.installer.resolveName(name),
	);
	if (!result) return session.text(".not-found");

	ctx.loader.envData.message = {
		// 同 performUpgrade:reload 后回到本会话回执
		...pick(session, ["sid", "channelId", "guildId", "isDirect"]),
		content: session.text(".success"),
	};
	try {
		await ctx.installer.install(result, undefined, () =>
			ensurePluginConfigs(ctx, Object.keys(result)),
		);
		// beforeReload 回调之外再补一次:覆盖安装未触发 reload 的场景
		await ensurePluginConfigs(ctx, Object.keys(result));
		return session.text(".success");
	} finally {
		// 同 performUpgrade:无论成败都清空定向回执
		ctx.loader.envData.message = null;
	}
}

/** 解析升级请求名单:显式名匹配已装依赖,缺省取全部;--koishi 追加自身。 */
function resolveRequestedNames(
	ctx: Context,
	deps: Dict<Dependency>,
	names: string[],
	includeSelf: boolean,
): string[] {
	const requested: string[] = names.length
		? names
				.map((name) =>
					ctx.installer.resolveName(name).find((candidate) => deps[candidate]),
				)
				.filter((name): name is string => !!name)
		: Object.keys(deps);
	if (includeSelf && !requested.includes("koishi")) requested.push("koishi");
	return requested;
}

/** plugin.upgrade 命令体:刷新元数据 → 计算目标 → 确认 → 执行升级。 */
async function runUpgradeCommand(
	ctx: Context,
	config: Config,
	session: Session | undefined,
	options: { self?: boolean; force?: boolean } | undefined,
	names: string[],
	getDataStore: () => MarketDataStore | undefined,
) {
	if (!session) return;
	options ||= {};
	// 先全量刷新元数据:升级目标判定依赖最新的 registry 缓存
	await ctx.installer.refresh(true, true);
	const deps = (await ctx.installer.getDeps({ background: false })) ?? {};
	const requested = resolveRequestedNames(ctx, deps, names, !!options.self);

	const updates = await collectUpgradeTargets(
		ctx,
		config,
		deps,
		requested,
		!!options.force,
		getDataStore,
		Date.now(),
	);
	if (!updates.length) return session.text(".all-updated");
	if (!(await confirmUpgrade(session, updates)))
		return session.text(".cancelled");
	const code = await performUpgrade(ctx, session, updates);
	if (code) return session.text(".failed", [code]);
	return session.text(".success");
}

/** 注册 plugin.install / plugin.uninstall / plugin.upgrade / plugin.clear-avatar-cache 四个命令。 */
export function registerCommands(
	ctx: Context,
	config: Config,
	getDataStore: () => MarketDataStore | undefined,
) {
	ctx.i18n.define("zh-CN", messageZh);
	ctx.i18n.define("en-US", messageEn);

	ctx
		.command("plugin.install <name>", { authority: 4 })
		.alias(".i")
		.action(async ({ session }, name) => runInstallCommand(ctx, session, name));

	ctx
		.command("plugin.uninstall <name>", { authority: 4 })
		.alias(".r")
		.action(async ({ session }, name) => {
			if (!session) return;
			if (!name) return session.text(".expect-name");
			const installed = await findInstalledName(ctx, name);
			if (!installed) return session.text(".not-installed");

			// 版本传 null = 卸载:core 安排器把 null 视为删除该依赖
			await ctx.installer.install({ [installed]: null as unknown as string });
			return session.text(".success");
		});

	ctx
		.command("plugin.upgrade [name...]", { authority: 4 })
		.alias(".update", ".up")
		.option("self", "-s, --koishi")
		.option("force", "-f, --force")
		.action(async ({ session, options }, ...names) =>
			runUpgradeCommand(ctx, config, session, options, names, getDataStore),
		);

	ctx
		.command("plugin.clear-avatar-cache", { authority: 4 })
		.action(async ({ session }) => {
			if (!session) return;
			const { memory, disk } = await clearAvatarCacheStorage(ctx);
			return session.text(".success", [memory, disk]);
		});
}
