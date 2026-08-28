/**
 * @file 安装落库后的配置节点就绪等待(shared/operations 域)。
 *
 * 确保已安装插件在 koishi.yml 里有配置节点:先请服务端 ensure-config(权威
 * 路径,会把保存的旧配置找回来),轮询等它生效;等不到再退回客户端
 * configWriter.ensure 兜底建一个空配置。批量安装后统一调用。
 */

import { Context, send, store } from "@koishi-ce/client";
import { getConfigWriter } from "./state";

/** 简易 sleep:轮询等待用。 */
function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 轮询等待包出现在 store.packages(最多 40×250ms = 10s),安装落库即返回。 */
async function waitForInstalledPackage(name: string) {
	for (let index = 0; index < 40; index++) {
		if (store.packages?.[name]) return;
		await sleep(250);
	}
}

/** 轮询等待插件配置节点出现(configWriter 能查到即算),超时返回 false。 */
async function waitForInstalledConfig(ctx: Context, name: string) {
	for (let index = 0; index < 40; index++) {
		if (getConfigWriter(ctx)?.get(name)?.length) return true;
		await sleep(250);
	}
	return false;
}

/**
 * 确保已安装插件在 koishi.yml 里有配置节点(单个)。
 * 服务端 ensure-config 为权威路径,客户端 configWriter.ensure 仅作兜底。
 */
export async function ensureInstalledConfig(
	ctx: Context,
	name: string,
	silent = true,
) {
	if (!name || !getConfigWriter(ctx)) return;
	await (send("market/ensure-config", name) ?? Promise.resolve(false)).catch(
		console.error,
	);
	await waitForInstalledPackage(name);
	if (await waitForInstalledConfig(ctx, name)) return;
	const configWriter = getConfigWriter(ctx);
	if (!configWriter || configWriter.get(name)?.length) return;
	configWriter.ensure(name, silent);
}

/** 批量版 ensureInstalledConfig:并行等待一组插件的配置就绪。 */
export async function ensureInstalledConfigs(
	ctx: Context,
	names: string[],
	silent = true,
) {
	await Promise.all(
		names.map((name) => ensureInstalledConfig(ctx, name, silent)),
	);
}
