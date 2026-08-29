/**
 * 应用装配：Loader.createApp 中与事件订阅相关的部分。
 *
 * 职责：订阅配置变更与插件生命周期事件（internal/fork、internal/update、
 * internal/before-update），把运行期的插件增删改同步回配置文件；
 * 以及处理 CLI 透传的启动消息。只做事件注册，不持有自身状态。
 */

import type { Context, Universal } from "@koishi-ce/core";
import type { Loader } from "./index.ts";
import { kRecord, kUpdate, type LoaderScope } from "./types.ts";
import { rename, separate } from "./utils.ts";

/** 记录一条插件生命周期日志（apply / unload / reload） */
export function logPluginUpdate(app: Context, type: string, key: string) {
	app.logger("loader").info("%s plugin %c", type, key);
}

/**
 * 订阅配置变更与插件生命周期事件，维护配置文件与应用状态。
 * 事件注册顺序与原 createApp 保持一致。
 */
export function wireAppEvents(loader: Loader, app: Context) {
	// 配置文件中的 plugins 表变化时，重新装载根组
	app.accept(
		["plugins"],
		(config) => {
			// 语义为 fire-and-forget：重载结果由 internal/* 事件链路自行回写
			void loader.reload(app, "group:entry", config.plugins);
		},
		{ passive: true },
	);

	// 根上下文被销毁意味着应用退出，交给子类决定如何整进程重启
	app.on("dispose", () => {
		loader.fullReload();
	});

	// 插件卸载时把配置键改写为 `~` 前缀（保留配置，便于恢复）
	app.on("internal/fork", (fork) => {
		// fork.uid 存在：这是新建的 fork（而非卸载）
		const record = (fork.parent.scope as LoaderScope)[kRecord];
		// record 不存在：该 fork 不由 loader 跟踪
		if (fork.uid || !record) return;
		const key = Object.keys(record).find((key) => {
			return record[key] === fork;
		});
		if (!key) return;
		logPluginUpdate(app, "unload", key);
		delete record[key];
		// fork 是由主作用域销毁的（如 hmr 插件）——此时无需回写配置。
		// 正常路径：ctx.dispose() -> fork / runtime 销毁 -> delete(plugin)
		// hmr 路径：delete(plugin) -> runtime 销毁 -> fork 销毁
		if (!app.registry.has(fork.runtime.plugin)) return;
		rename(
			fork.parent.scope.config,
			key,
			`~${key}`,
			fork.parent.scope.config[key],
		);
		loader.writeConfig();
	});

	app.on("internal/update", (fork) => {
		const key = loader.getRefName(fork);
		if (key) logPluginUpdate(app, "reload", key);
	});

	// 插件配置被运行期更新时同步回配置文件（保留元属性、经 schema 简化）
	app.on("internal/before-update", (fork, config) => {
		// loader 自身发起的更新（kUpdate 标记）不回写，避免循环
		if ((fork as LoaderScope)[kUpdate]) {
			return delete (fork as LoaderScope)[kUpdate];
		}
		const name = loader.getRefName(fork);
		if (!name) return;
		const { schema } = fork.runtime;
		fork.parent.scope.config[name] = {
			...separate(fork.parent.scope.config[name])[1],
			...(schema ? schema.simplify(config) : config),
		};
		loader.writeConfig();
		return undefined;
	});
}

/**
 * 处理 CLI 透传的启动消息：目标机器人上线后自动发送一条消息。
 * 消息取出后立即清空，避免整进程重启后重复发送。
 */
export function handleStartMessage(loader: Loader, app: Context) {
	if (!loader.envData.message) return;
	const { sid, channelId, guildId, content } = loader.envData.message;
	loader.envData.message = null;
	const dispose = app.on("bot-status-updated", (bot) => {
		if (bot.sid !== sid || bot.status !== (1 satisfies Universal.Status))
			return;
		dispose();
		if (channelId === undefined) return;
		bot.sendMessage(channelId, content, guildId);
	});
}
