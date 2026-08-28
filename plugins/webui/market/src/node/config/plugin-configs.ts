/**
 * @file 安装后补建插件的"禁用态"配置条目(config 域)。
 *
 * 模块职责:
 * - ensurePluginConfig:单个插件在 koishi.yml 缺配置时,先请求运行时补建,
 *   仍缺则手写一个 `~短名:随机 ident` 的空配置键(~ 前缀 = 保持禁用);
 * - ensurePluginConfigs:批量版,集中写盘一次并刷新 config/packages 通道;
 * - ensureInstalledPluginConfigs:启动修复扫描,为"已装但无配置"的插件
 *   补条目(如手工 npm install 的插件)。
 *
 * 关键设计:
 * - 只建禁用态条目:安装≠启用,用户应在配置页自行开启,避免装完即意外生效;
 * - 排除本插件自身(SELF_PACKAGE)与合包依赖(其配置由 bundle writer 统一
 *   生成,不能在这里抢跑);
 * - 先走 console 的 config/request-runtime listener(宿主正式流程,会带
 *   Schema 默认值),失败才手写最小条目兜底。
 *
 * 架构位置:node 适配层 config 模块,被安装编排(install listener、
 * plugin.install 命令)与 setup.ts 的启动修复消费。
 */
import type { Context } from "@koishi-ce/koishi";
import { loadManifest, Scanner } from "../../core/registry/manifest.js";
import { sleep } from "../../core/utils/async.js";
import {
	BUNDLE_KEYWORD,
	isBundlePackageName,
	parseBundleManifest,
} from "../../shared/bundle.js";
import { getPluginShortname } from "../../shared/bundle-idents.js";
import { refreshConsole } from "../console/refresh.js";
import { SELF_PACKAGE } from "../installer/index.js";
import { hasPluginConfigInTree, type PluginConfigMap } from "./plugins-map.js";

/**
 * 在 plugins 顶层创建 `~短名:随机 ident` 的空配置键(~ 前缀保持禁用)。
 * 随机 ident 避免与既有键冲突;loader 只读(外部编排器管理)时放弃。
 *
 * @returns 新建的键名;创建失败返回 undefined
 */
function createDisabledPluginConfig(ctx: Context, shortname: string) {
	const plugins = ctx.loader.config?.plugins as PluginConfigMap | undefined;
	if (!plugins || !ctx.loader.writable) return;
	let ident: string;
	let key: string;
	do {
		ident = Math.random().toString(36).slice(2, 8);
		key = `~${shortname}:${ident}`;
	} while (key in plugins);
	plugins[key] = {};
	return key;
}

/**
 * 判断依赖是否为合包(bundle)类包:命名形态命中,或已装 manifest 带
 * koishi.bundle 清单 / bundle 关键字。合包成员的配置由 bundle writer
 * 按清单统一生成,不走通用补建。
 */
function isPluginBundleDependency(ctx: Context, name: string) {
	if (isBundlePackageName(name)) return true;
	try {
		const meta = loadManifest(name, ctx.baseDir);
		return (
			!!parseBundleManifest(
				(meta.koishi as { bundle?: unknown } | undefined)?.bundle,
			) ||
			meta.keywords?.some((keyword) => keyword.toLowerCase() === BUNDLE_KEYWORD)
		);
	} catch {
		return false;
	}
}

/**
 * 请求宿主的 config/request-runtime listener 为插件补运行时配置:这是
 * @koishi-ce/plugin-config 提供的正式流程,会按 Schema 填默认值。listener
 * 不存在或抛错都不阻断(调用方 catch 后走手写兜底)。
 */
async function requestPluginRuntime(ctx: Context, name: string) {
	const listener = ctx.get("console")?.listeners["config/request-runtime"];
	const callback = listener?.callback as
		| ((name: string) => Promise<void>)
		| undefined;
	await callback?.call(null, name);
}

/**
 * 确保单个插件在配置树中有条目(含 group 嵌套):非插件、本插件自身、
 * 合包依赖直接跳过;先试运行时补建,仍缺才手写禁用态条目。
 *
 * @param write 是否立即写盘(批量场景传 false,由外层统一写)
 * @returns 是否新建了配置条目
 */
export async function ensurePluginConfig(
	ctx: Context,
	name: string,
	write = true,
) {
	if (!Scanner.isPlugin(name)) return false;
	if (name === SELF_PACKAGE) return false;
	if (isPluginBundleDependency(ctx, name)) {
		ctx
			.logger("market")
			.debug(`skip default config entry for plugin bundle: ${name}`);
		return false;
	}

	const shortname = getPluginShortname(name);
	if (hasPluginConfigInTree(ctx.loader.config?.plugins, shortname))
		return false;

	// 正式流程失败只 warn:还有手写兜底,不值得让安装整体报错
	await requestPluginRuntime(ctx, name).catch((error) =>
		ctx.logger("market").warn(error),
	);
	if (hasPluginConfigInTree(ctx.loader.config?.plugins, shortname))
		return false;

	const key = createDisabledPluginConfig(ctx, shortname);
	if (!key) return false;
	if (write) await ctx.loader.writeConfig();
	ctx
		.logger("market")
		.info("created disabled default config entry %c for %c", key, name);
	return true;
}

/**
 * 批量补建:逐个 ensurePluginConfig(不即时写盘),每 20 个让出事件循环,
 * 有改动才统一写盘并刷新 config/packages 通道。
 *
 * @returns 是否发生了写盘(全部已有配置时返回 false)
 */
export async function ensurePluginConfigs(ctx: Context, names: string[]) {
	const start = Date.now();
	let changed = false;
	let checked = 0;
	for (const name of names.filter((name) => Scanner.isPlugin(name))) {
		if (!ctx.scope.isActive) return false;
		if (await ensurePluginConfig(ctx, name, false)) changed = true;
		if (++checked % 20 === 0) await sleep(0);
	}
	if (!changed) return false;
	await ctx.loader.writeConfig();
	await refreshConsole(ctx, ["config", "packages"]);
	ctx
		.logger("market")
		.info(
			`plugin config ensure completed: checked=${checked}, elapsed=${Date.now() - start}ms`,
		);
	return true;
}

/**
 * 启动修复扫描:对照宿主 package.json 依赖,找出"已安装、非合包、但配置
 * 树没有条目"的插件(如手工 npm install),交给 ensurePluginConfigs 补建。
 *
 * @returns 是否发生了补建
 */
export async function ensureInstalledPluginConfigs(ctx: Context) {
	const start = Date.now();
	const manifest = loadManifest(ctx.baseDir);
	const names = Object.keys(manifest.dependencies ?? {})
		.filter((name) => Scanner.isPlugin(name))
		.filter((name) => !isPluginBundleDependency(ctx, name));
	const missing = names.filter(
		(name) =>
			!hasPluginConfigInTree(
				ctx.loader.config?.plugins,
				getPluginShortname(name),
			),
	);
	if (!missing.length) return false;
	await sleep(0);
	const changed = await ensurePluginConfigs(ctx, missing);
	ctx
		.logger("market")
		.info(
			`installed plugin config repair scan completed: total=${names.length}, missing=${missing.length}, changed=${changed}, elapsed=${Date.now() - start}ms`,
		);
	return changed;
}
