/**
 * 前端入口（Entry）：声明一段供控制台浏览器加载的扩展脚本及其附带数据。
 *
 * 由插件的入口文件（entry.ts）通过 ctx.console.addEntry() 创建，
 * 注册后立刻触发 entry 数据服务刷新；随宿主上下文销毁自动注销。
 * 入口信息最终经 EntryProvider 下发到前端，驱动浏览器加载对应脚本。
 */

import type { Context } from "@koishi-ce/koishi";
import type { Client } from ".";

export namespace Entry {
	/**
	 * 入口的文件声明：
	 * - 字符串 / 字符串数组：所有环境统一加载的文件；
	 * - 选项对象：区分开发（dev，源文件走 HMR）与生产（prod，构建产物）环境。
	 */
	export type Files = string | string[] | EntryOptions;

	export interface EntryOptions {
		/** 开发环境加载的文件路径 */
		dev: string;
		/** 生产环境加载的文件路径（单个或多个） */
		prod: string | string[];
	}
}

/** 前端入口实例 */
export class Entry<T = unknown> {
	/** 入口随机标识，用于前端与广播消息的关联 */
	public id = Math.random().toString(36).slice(2);
	/** 注销本入口的清理函数 */
	public dispose: () => void;

	/** 注册本入口的上下文 */
	public ctx: Context;
	/** 文件声明 */
	public files: Entry.Files;
	/** 按客户端惰性求值的初始数据工厂 */
	public data: ((client: Client) => T) | undefined;

	constructor(ctx: Context, files: Entry.Files, data?: (client: Client) => T) {
		this.ctx = ctx;
		this.files = files;
		this.data = data;
		ctx.console.entries[this.id] = this;
		ctx.console.refresh("entry");
		this.dispose = ctx.effect(() => {
			return () => {
				delete this.ctx.console.entries[this.id];
				ctx.console.refresh("entry");
			};
		});
	}

	/**
	 * 向所有客户端广播本入口的最新数据（entry-data 消息）。
	 * 数据按客户端分别求值，附带入口 id 供前端定位。
	 */
	refresh() {
		this.ctx.console.broadcast("entry-data", async (client: Client) => ({
			id: this.id,
			data: await this.data?.(client),
		}));
	}
}
