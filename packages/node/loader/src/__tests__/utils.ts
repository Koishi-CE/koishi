/**
 * loader 测试桩：不落盘、不解析真实模块的 Loader 实现。
 *
 * 以内存中的 data 表代替插件注册表（按名惰性生成 mock 插件），
 * 用于在无配置文件、无 node_modules 的环境下驱动 createApp 流程。
 */

import { mock as jest } from "node:test";
import type { Context, Dict } from "@koishi-ce/koishi";
import { Loader } from "../index";

export default class TestLoader extends Loader {
	/**
	 * 插件名 -> mock 插件对象 的内存注册表。
	 * 以 any 弱化：registry.get 期望 cordis 泛型插件，而此处存的是
	 * koishi 侧 Plugin.Object<Context>，参数逆变导致直接声明无法通过
	 */
	data: Dict<any> = Object.create(null);

	/** 返回按名惰性创建的 mock 插件；foo 插件在 apply 时抛错以模拟加载失败 */
	async import(name: string) {
		return (this.data[name] ||= {
			name,
			apply: (ctx: Context) => {
				if (name === "foo") throw new Error("error from plugin");
				ctx.on(`test/${name}` as any, jest.fn());
				ctx.accept();
			},
		});
	}

	/** 整进程重载在测试中仅打印提示 */
	fullReload() {
		console.info("trigger full reload");
	}

	// 测试桩未提供真实配置文件,writeConfig 会因 filename 未定义产生
	// 未处理 rejection(mocha 容忍,bun test 判败),此处按测试意图置空
	override writeConfig() {
		return Promise.resolve();
	}
}
