import { defineConfig } from "tsdown";

/**
 * create-koishi-ce 脚手架的独立构建配置（npm 包名 create-koishi-ce，
 * 目录名 apps/koishi-create，二者不一致是历史遗留；不进根 tsdown 的
 * workspace，需进本目录单独 `bun run build`）。
 *
 * 仅产出 CJS 单格式：这是被 `npx create-koishi-ce` 直接执行的 CLI
 * （仓库根的 bin.js 以 require("./lib") 引导），无 ESM 消费场景，
 * 与根构建的「CJS + ESM 双格式」策略不同。
 */
export default defineConfig({
	// 入口即脚手架主流程（帮助信息与交互逻辑都在其中）
	entry: ["src/index.ts"],
	format: "cjs",
	dts: true,
	platform: "node",
	// 产物固定为 lib/index.js：bin.js 与 package.json 的 main 都按此引用，
	// 不走双格式场景下的 .cjs 固定扩展名
	outDir: "lib",
	fixedExtension: false,
	clean: true,
});
