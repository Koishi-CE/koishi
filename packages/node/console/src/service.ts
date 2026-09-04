// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 数据服务基类（DataService）：控制台服务端向前端推送数据的抽象载体。
 *
 * 每个数据服务以 `console.services.<key>` 为服务名注册到容器，
 * 前端通过 service key 订阅。两种推送方式：
 * - refresh：重新执行 get() 并整体广播（data 消息）；
 * - patch：直接广播增量补丁（patch 消息），适合局部更新。
 *
 * 每次推送都会带上 options 参与 console/intercept 拦截判断。
 */

import type Console from "@koishi-ce/console";
import type { Client } from "@koishi-ce/console";
import { type Context, Service } from "@koishi-ce/koishi";

export namespace DataService {
	/** 数据服务选项 */
	export interface Options {
		/** 服务启动时立即推送一次数据 */
		immediate?: boolean;
		/** 访问该数据所需的最低权限等级 */
		authority?: number;
	}
}

/**
 * 数据服务抽象基类。
 *
 * 派生类实现 get() 返回当前数据；如声明了 immediate 选项，
 * 服务启动时会自动触发一次 refresh。
 */
export abstract class DataService<
	T = never,
> extends Service {
	static filter = false;
	static inject = ["console"];

	/**
	 * 计算当前数据。
	 *
	 * @param forced 是否强制刷新（区别于增量缓存场景）
	 * @param client 请求方客户端，可据此返回差异化数据
	 */
	public async get(
		_forced?: boolean,
		_client?: Client,
	): Promise<T> {
		return null as T;
	}

	protected override ctx: Context;
	/** 服务标识，同时也是前端订阅使用的 key */
	protected key: keyof Console.Services;
	/** 构造时传入的选项，随广播参与拦截判断 */
	public options: DataService.Options = {};

	constructor(
		ctx: Context,
		key: keyof Console.Services,
		options: DataService.Options = {},
	) {
		super(
			ctx,
			`console.services.${key}`,
			options.immediate,
		);
		this.ctx = ctx;
		this.key = key;
		this.options = options;
	}

	override start() {
		void this.refresh();
	}

	/**
	 * 重新计算并整体广播当前数据。
	 *
	 * @param forced 是否以"强制刷新"语义调用 get()
	 */
	async refresh(forced = true) {
		this.ctx.get("console")?.broadcast(
			"data",
			async (client: Client) => ({
				key: this.key,
				value: await this.get(forced, client),
			}),
			this.options,
		);
	}

	/**
	 * 广播增量补丁（不重新计算完整数据）。
	 *
	 * @param value 补丁内容，由具体服务约定格式
	 */
	patch(value: T) {
		this.ctx.get("console")?.broadcast(
			"patch",
			{
				key: this.key,
				value,
			},
			this.options,
		);
	}
}
