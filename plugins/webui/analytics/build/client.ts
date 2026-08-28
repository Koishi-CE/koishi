/**
 * analytics 前端的 vite 构建配置。
 *
 * 核心是下方 "fuck-echarts" 插件——echarts chunk 内的 Symbol 重命名 hack：
 *
 * 背景：echarts 内部有一个图形类，名字恰好就叫 `Symbol`（chart/helper/Symbol，
 * 负责绘制折线 / 散线图的数据点标记）。vite/rollup 打包时会把 echarts 的各 ESM
 * 模块合并进同一个 chunk，该类的 `var Symbol = ...` 声明因此位于 chunk 顶层，
 * 会遮蔽（shadow）全局内置的 Symbol。
 *
 * 问题场景：本插件的前端可被打进"Koishi 本体与全部插件同宿一个浏览器包"的
 * 在线环境（上游 koishi-plugin-browser，本仓对应 apps/online 的 PPA 在线化）。
 * 此时同包内 Koishi / cordis 等代码期望的 `Symbol.iterator`、`Symbol()` 等
 * 内置能力会被 echarts 的同名图形类遮蔽，直接导致运行时崩溃。
 *
 * 解法：在 renderChunk 阶段对文件名含 "echarts" 的 chunk 做文本级替换，
 * 把所有 `Symbol` 标识符统一改名为 `FuckSymbol`——图形类的声明与引用被
 * 一致地改名，chunk 内部依旧自洽；全局内置 Symbol 不再被遮蔽。
 *
 * 两点依据（已核实 echarts 6 发行包）：
 * 1. 包内不存在对全局 `Symbol()` 构造器的直接调用（所有 `Symbol(` 出现
 *    均属于上述图形类），也没有 `Symbol.for` / `typeof Symbol` 等用法，
 *    因此整体重命名不会把内置调用改成未定义引用；
 * 2. 负向断言 `(?!\.toStringTag)` 排除 `Symbol.toStringTag` 属性访问——
 *    那访问的一定是内置对象的静态属性，改名会抛 ReferenceError。
 *
 * 动这块构建链前请先读 AGENTS.md 的"特殊构建 hack"条目。
 */
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		{
			name: "fuck-echarts",
			renderChunk(code, chunk) {
				if (chunk.fileName.includes("echarts")) {
					return code.replace(/\bSymbol(?!\.toStringTag)/g, "FuckSymbol");
				}
			},
		},
	],
});
