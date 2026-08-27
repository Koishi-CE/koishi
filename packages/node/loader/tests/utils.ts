import { mock as jest } from "node:test";
import type { Context, Dict, Plugin } from "@koishi-ce/koishi";
import { Loader } from "../src";

export default class TestLoader extends Loader {
	// @ts-expect-error
	data: Dict<Plugin.Object<Context>> = Object.create(null);

	async import(name: string) {
		return (this.data[name] ||= {
			name,
			apply: (ctx) => {
				if (name === "foo") throw new Error("error from plugin");
				ctx.on(`test/${name}` as any, jest.fn());
				ctx.accept();
			},
		});
	}

	fullReload() {
		console.info("trigger full reload");
	}

	// 测试桩未提供真实配置文件,writeConfig 会因 filename 未定义产生
	// 未处理 rejection(mocha 容忍,bun test 判败),此处按测试意图置空
	writeConfig() {
		return Promise.resolve();
	}
}
