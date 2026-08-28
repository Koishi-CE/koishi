/**
 * explorer 插件的前端构建配置覆盖。
 *
 * 构建链已知 hack：monaco-editor 体积巨大（数 MB），若打进主 chunk 会显著拖慢
 * 控制台首屏加载。这里通过 rollup 的 manualChunks 把它强制拆分为独立的
 * `monaco` chunk，使其可以并行加载并被浏览器长期缓存——explorer 插件本体
 * 更新时无需让用户重新下载整个编辑器。
 */
import { defineConfig } from "vite";

export default defineConfig({
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					monaco: ["monaco-editor"],
				},
			},
		},
	},
});
