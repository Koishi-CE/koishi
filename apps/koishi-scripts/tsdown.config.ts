import { defineConfig } from "tsdown";

/**
 * @koishi-ce/scripts 的独立构建配置（不进根 tsdown 的 workspace，
 * 需进本目录单独 `bun run build`）。
 *
 * 仅产出 CJS 单格式：这是一个被 `npx koishi-scripts` 直接执行的 CLI
 * （仓库根的 bin.js 以 require("./lib/bin") 引导），index.ts 的共享
 * 工具也以 lib/index.js 供各子命令 require，无 ESM 消费场景。
 */
export default defineConfig({
	// bin：CLI 入口；index：供子命令复用的共享工具（cwd / meta / confirm）
	entry: ["src/bin.ts", "src/index.ts"],
	format: "cjs",
	dts: true,
	platform: "node",
	// 产物固定为 lib/*.js：bin.js 与 package.json 的 main 都按此引用，
	// 不走双格式场景下的 .cjs 固定扩展名
	outDir: "lib",
	fixedExtension: false,
	clean: true,
});
