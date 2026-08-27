import { defineConfig } from "tsdown";

/**
 * 根级统一构建：一个配置构建所有 node 侧子包（packages / plugins）。
 *
 * - 源码保持 ESM（编辑器与类型检查按 ESM 解析），但 Koishi 的 loader 用
 *   require() 加载插件，因此产物固定为 CJS。各包 package.json 均无
 *   "type": "module"，输出 .js 即为 CommonJS，无需改扩展名。
 * - workspace 内 @koishi-ce/* 互相引用按包名外部化（运行时由 node_modules
 *   的 workspace 链接提供）；类型声明只保留对依赖的引用，不做跨包内联。
 * - locale 的 .yml 原样拷入产物（引用路径自动改写），运行时由 koishi
 *   内置的 yml-register 直接加载。
 * - packages/web/components、market 仅作为客户端源码被 console 打包器消费，
 *   无独立 CJS 产物；webui 插件的 .vue 部分由 vite 构建。
 * - apps/create-koishi-ce 与 apps/koishi-scripts 各有自己的 tsdown.config.ts。
 */
export default defineConfig({
	workspace: {
		include: [
			"packages/node/*",
			"plugins/common/*",
			"plugins/infra/*",
			"plugins/webui/*",
		],
		exclude: [
			"plugins/infra/http",
			"plugins/infra/proxy-agent",
			"plugins/infra/server",
		],
	},
	entry: "src/index.ts",
	format: "cjs",
	dts: true,
	platform: "node",
	outDir: "lib",
	clean: true,
	// 各包 main 指向 lib/index.js（无 "type" 字段的 CJS 包），保持默认扩展名
	fixedExtension: false,
	deps: {
		neverBundle: [/^@koishi-ce\//],
		// 声明文件不内联外部包类型，仅保留 import 引用
		dts: { neverBundle: true },
	},
	loader: { ".yml": "copy" },
	inputOptions: {
		resolve: {
			extensions: [
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
			],
		},
	},
});
