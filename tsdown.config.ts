import type { UserConfig } from "tsdown";
import { defineConfig } from "tsdown";

/**
 * 根级统一构建：一个配置构建所有 node 侧子包（packages / plugins）。
 *
 * - 源码保持 ESM（编辑器与类型检查按 ESM 解析），但 Koishi 的 loader 用
 *   require() 加载插件，CJS 产物（index.js）是必须的；loader / cli 等包
 *   的 package.json 同时声明 node.import → index.mjs，因此统一追加
 *   ESM 产物，未被 exports 引用的 .mjs 对其余包无副作用。
 * - workspace 内 @koishi-ce/* 互相引用按包名外部化（运行时由 node_modules
 *   的 workspace 链接提供）；类型声明只保留对依赖的引用，不做跨包内联。
 * - locale 的 .yml 原样拷入产物（引用路径自动改写），运行时由 koishi
 *   内置的 yml-register 直接加载。
 * - packages/web/components、market 仅作为客户端源码被 console 打包器消费，
 *   无独立运行时产物；webui 插件的 .vue 部分由 vite 构建。
 * - @koishi-ce/koishi（cli）、apps/create-koishi-ce 与 apps/koishi-scripts
 *   各有自己的 tsdown.config.ts。
 */
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

const workspace = {
	include: [
		"packages/node/*",
		"apps/registry",
		"plugins/common/*",
		"plugins/infra/*",
		"plugins/webui/*",
	],
	exclude: [
		"plugins/infra/http",
		"plugins/infra/proxy-agent",
		"plugins/infra/server",
	],
};

const common: UserConfig = {
	entry: "src/index.ts",
	platform: "node" as const,
	outDir: "lib",
	deps: {
		neverBundle: [/^@koishi-ce\//],
		// 声明文件不内联外部包类型，仅保留 import 引用
		dts: { neverBundle: true },
	},
	// locale 位于包根目录，源码中的相对导入会触发 yml 原样复制
	loader: { ".yml": "copy" },
	inputOptions: { resolve: { extensions } },
};

export default defineConfig([
	{
		...common,
		workspace,
		format: "cjs",
		dts: true,
		clean: true,
		// 双格式同目录时 tsdown 会自动切换固定扩展名（.cjs），
		// 而各包 exports 声明的是 require → index.js，显式对齐
		outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
	},
	{
		...common,
		workspace,
		format: "esm",
		dts: false,
		clean: false,
		outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
	},
]);
