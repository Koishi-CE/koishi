import type { UserConfig } from "tsdown";
import { defineConfig } from "tsdown";

/**
 * 根级统一构建：一个配置构建所有 node 侧子包（packages / plugins），
 * 单遍 ESM-only（index.mjs + index.d.ts）。
 *
 * - 本仓库全面拥抱 Bun 运行时：Bun 的 require() 可直接加载 ESM，
 *   各包 exports 以 `default` 条件兜底 require 解析，CJS 双格式产物
 *   已退役（各包 package.json 正逐个完成 ESM-only 收敛）。
 * - workspace 内 @koishi-ce/* 互相引用按包名外部化（运行时由 node_modules
 *   的 workspace 链接提供）；类型声明只保留对依赖的引用，不做跨包内联。
 * - locale 的 .yml 原样拷入产物（引用路径自动改写），Bun 运行时原生
 *   支持 yml 导入，直接加载。
 * - packages/web/components、market 仅作为客户端源码被 console 打包器消费，
 *   无独立运行时产物；webui 插件的 .vue 部分由 vite 构建。
 * - 例外（不走本配置）：vendored 三包（plugins/infra/{http,proxy-agent,
 *   server}，预编译产物包，见 workspace.exclude）；apps/online 为 vite
 *   编程式构建。apps/koishi-create 与 apps/koishi-scripts 走本配置，仅以
 *   包级 tsdown.config.ts 补 bin 入口（产物 lib/bin.mjs，首行 bun shebang）。
 */
// 模块解析扩展名顺序：显式包含 .yml，让无扩展名的 locale 相对导入
// （如 `../locales/zh-CN`）能在构建时解析到 .yml 文件并触发 copy loader
const extensions = [
	".tsx",
	".ts",
	".jsx",
	".js",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".json",
	".yml",
];

// tsdown workspace 模式的包发现范围：覆盖全部 node 侧子包；
// vendored 三包（plugins/infra/{http,proxy-agent,server}）是预编译
// 产物包（无 src/、分别内联再导出 @cordisjs/plugin-*），显式排除；
// file-type-compat 是同样不走构建的纯 JS 预编译 shim（见其 index.js 注释）；
// packages/web/components 仅作为客户端源码被 console 打包器消费，
// 无独立运行时产物，同样排除
const workspace = {
	include: [
		"packages/node/*",
		"packages/web/*",
		"apps/koishi-scripts",
		"apps/koishi-create",
		"plugins/common/*",
		"plugins/infra/*",
		"plugins/webui/*",
	],
	exclude: [
		"plugins/infra/http",
		"plugins/infra/proxy-agent",
		"plugins/infra/server",
		"plugins/infra/file-type-compat",
		"packages/web/components",
		// packages/shim/* 全部是上游包名占位 shim（纯 JS 预编译、无 src/，
		// 单行 re-export @koishi-ce 对应包，见各包 index.mjs 注释）：
		// workspace 占位（koishi 裸名 / upstream-core / upstream-loader /
		// upstream-plugin-console，private）与发布版（koishi-shim /
		// console-shim，供下游项目 npm alias 占名）
		"packages/shim/*",
	],
};

const config: UserConfig = {
	workspace,
	entry: "src/index.ts",
	platform: "node" as const,
	outDir: "lib",
	format: "esm",
	dts: true,
	clean: true,
	deps: {
		neverBundle: [/^@koishi-ce\//],
		// 声明文件不内联外部包类型，仅保留 import 引用
		dts: { neverBundle: true },
	},
	// locale 位于包根目录，源码中的相对导入会触发 yml 原样复制
	loader: { ".yml": "copy" },
	// pluginTimings 是 rolldown 默认开启的插件耗时统计：workspace 并行构建时
	// 几十个包各刷一段 PLUGIN_TIMINGS（构建热身期 resolveId 占比高），纯噪音，关闭
	inputOptions: { resolve: { extensions }, checks: { pluginTimings: false } },
	// ESM 产物用 .mjs 扩展名（不依赖各包的 "type": "module" 逐步到位），
	// 声明文件保持 .d.ts（各包 exports 的 types 条件均指向它）
	outExtensions: () => ({ js: ".mjs", dts: ".d.ts" }),
};

export default defineConfig([config]);
