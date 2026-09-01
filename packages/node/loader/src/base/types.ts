// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * loader 的公共类型与内部符号键。
 *
 * - 通过模块合并向 @koishi-ce/core 注入 loader 服务、事件与配置项声明；
 * - 定义作用域扩展接口 LoaderScope 与跨模块共享的符号键（kRecord / kUpdate）。
 */

import type { Dict, EffectScope, ForkScope } from "@koishi-ce/core";
import type { Loader } from "./index.ts";

// 通过模块合并向全局类型注入 loader 服务、相关事件与配置项
declare module "@koishi-ce/core" {
	interface Events {
		/** 配置文件被写入后触发 */
		config(): void;
		/** 进程收到终止信号、各插件清理完毕前触发 */
		exit(signal: NodeJS.Signals): Promise<void>;
	}

	interface Context {
		/** 插件加载器服务 */
		loader: Loader;
	}

	namespace Context {
		interface Config {
			/** 应用名称 */
			name?: string;
			/** 插件配置表，键为插件引用（可带 `group:` 前缀） */
			plugins?: Dict;
		}
	}
}

/** CLI 透传给新进程的启动消息：让指定机器人就绪后主动发送一条消息 */
export interface StartMessage {
	/** 是否私聊 */
	isDirect?: boolean;
	/** 目标频道号 */
	channelId?: string;
	/** 目标群号 */
	guildId?: string;
	/** 目标机器人平台自增 ID */
	sid?: string;
	/** 要发送的消息内容 */
	content: string;
}

/** 跨重启共享的数据（KOISHI_SHARED 环境变量透传） */
export interface SharedData {
	/** 上次启动时间 */
	startTime?: number;
	/** 待发送的启动消息（发送或重启后清空） */
	message?: StartMessage | null;
	/** 控制台记录的已连接客户端数（console 插件维护） */
	clientCount?: number;
}

/** 作用域上记录"插件引用 -> fork"映射的符号键（全局注册，跨 Realm 共享） */
export const kRecord = Symbol.for("koishi.loader.record");

/** 内部标记：本次 fork 更新来源于 loader 的 reload（而非用户改配置） */
export const kUpdate = Symbol("update");

// 理论上这些属性只会出现在 `ForkScope` 上。
// 为了书写类型方便，这里直接定义在 scope 类型上。
// （上游通过 `declare module '@cordisjs/core'` 声明这些属性，但从本包
// 无法解析该模块，故改用结构化的子接口实现。）
export interface LoaderScope extends EffectScope {
	/** 本作用域下由 loader 管理的插件 fork 记录，键为插件引用 */
	[kRecord]?: Dict<ForkScope>;
	/** 内部标记：本次更新来自 loader 的 reload 流程 */
	[kUpdate]?: boolean;
	/** 插件标识（插件引用去掉 `name:` 前缀后的部分） */
	key?: string;
}
