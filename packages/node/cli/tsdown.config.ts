import { defineConfig } from "tsdown";

/**
 * @koishi-ce/koichi 是发布级框架包，与各插件的单一 CJS 约定不同：
 * package.json 声明了双格式产物（main → .cjs / module → .mjs）以及
 * ./lib/cli、./lib/worker 子路径入口，本配置逐项对齐 exports。
 *
 * workspace 内 @koishi-ce/* 互相引用按包名外部化；声明文件不内联
 * 外部包类型，仅保留 import 引用；.yml 由 loader 原样拷入产物。
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

export default defineConfig([
	{
		entry: {
			index: "src/index.ts",
			"cli/index": "src/cli/index.ts",
			"worker/index": "src/worker/index.ts",
		},
		format: "cjs",
		dts: true,
		platform: "node",
		outDir: "lib",
		clean: true,
		outExtensions: () => ({ js: ".cjs", dts: ".d.ts" }),
		deps: { neverBundle: [/^@koishi-ce\//], dts: { neverBundle: true } },
		loader: { ".yml": "copy" },
		inputOptions: { resolve: { extensions } },
	},
	{
		entry: { index: "src/index.ts" },
		format: "esm",
		dts: false,
		platform: "node",
		outDir: "lib",
		outExtensions: () => ({ js: ".mjs", dts: ".d.mts" }),
		deps: { neverBundle: [/^@koishi-ce\//] },
		loader: { ".yml": "copy" },
		inputOptions: { resolve: { extensions } },
	},
]);
