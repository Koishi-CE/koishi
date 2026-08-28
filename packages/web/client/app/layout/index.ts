/**
 * 布局插件：向全局 "layout" 插槽注册三栏布局组件。
 * order 取极小值保证它先于其它同插槽内容排序（作为页面骨架）。
 */

import type { Context } from "@koishi-ce/client";
import Layout from "./layout.vue";

export default function (ctx: Context) {
	ctx.slot({
		type: "layout",
		component: Layout,
		order: -1000,
	});
}
