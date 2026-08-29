import { defineConfig } from "tsdown";

/**
 * @koishi-ce/koishi 的包级构建配置（只补差异，其余沿用根 tsdown 配置）：
 * 补 CLI 与 worker 两个入口——bin 字段指向 lib/cli/index.mjs（首行 bun
 * shebang 由 rolldown 原样保留），守护进程经 lib/cli/ 的 import.meta.dir
 * 相对定位 lib/worker/index.mjs，两者都必须有独立产物。
 */
export default defineConfig({
	entry: ["src/index.ts", "src/cli/index.ts", "src/worker/index.ts"],
});
