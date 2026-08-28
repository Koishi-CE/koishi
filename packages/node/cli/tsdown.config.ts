import { defineConfig } from "tsdown";

/**
 * @koishi-ce/koishi 是发布级框架包，包含主库、CLI 和 worker 三个入口。
 * workspace 内 @koishi-ce/* 互相引用按包名外部化；.yml 由 loader 原样拷入产物。
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

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"cli/index": "src/cli/index.ts",
		"worker/index": "src/worker/index.ts",
	},
	format: "esm",
	dts: true,
	platform: "node",
	outDir: "lib",
	clean: true,
	outExtensions: () => ({ js: ".mjs", dts: ".d.ts" }),
	deps: { neverBundle: [/^@koishi-ce\//], dts: { neverBundle: true } },
	loader: { ".yml": "copy" },
	inputOptions: { resolve: { extensions } },
});
