import yaml from "@maikolib/vite-plugin-yaml";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [vue(), yaml()],
	resolve: {
		conditions: ["source"],
		alias: {
			"vue-i18n": "@koishi-ce/client",
			"@koishi-ce/components": "@koishi-ce/client",
		},
	},
	ssr: {
		resolve: {
			conditions: ["source"],
		},
	},
	test: {
		include: ["src/**/*.test.ts", "client/**/*.test.ts"],
		environment: "node",
		coverage: {
			// .vue 组件(node 环境无 DOM 不可测)与 locales 数据文件(纯数据/生成物)
			// 不在测试范围,排除出覆盖统计,口径与覆盖率攻坚计划的 ts 模块目标一致
			exclude: [
				"client/**/*.vue",
				"client/**/locales/**",
				"src/node/locales/**",
			],
		},
	},
});
