import yaml from "@maikolib/vite-plugin-yaml";
import vue from "@vitejs/plugin-vue";
import { existsSync, promises as fs, globSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import * as vite from "vite";

// vite 8 基于 rolldown,rollup 已不在依赖树中;这里按实际消费的字段
// 局部声明构建产物类型(替代原先的 `import type { RollupOutput }`)
interface BuildResult {
	output: Array<{
		fileName: string;
		type: string;
		source?: any;
		code?: string;
	}>;
}

// 将全部工作区包名映射到其源码目录,行为对齐根 tsconfig 的 paths 别名。
// 没有被任何工作区包依赖的插件(如 plugin-logger)不会出现在 node_modules
// 的链接里,bundler 无法按包名解析,必须显式提供这层映射。
function collectWorkspaceAliases(): Record<string, string> {
	const here = dirname(
		new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
	);
	const repoRoot = resolve(here, "../../../..");
	const manifest = JSON.parse(readFileSync(repoRoot + "/package.json", "utf8"));
	const aliases: Record<string, string> = {};
	for (const pattern of manifest.workspaces ?? []) {
		let files: string[] = [];
		try {
			files = globSync(`${repoRoot}/${pattern}/package.json`);
		} catch {}
		for (const file of files) {
			const dir = dirname(file).replace(/\\/g, "/");
			try {
				const { name } = JSON.parse(readFileSync(file, "utf8"));
				if (!name) continue;
				// 控制台前端语境下,裸包名对到浏览器端入口(替代上游 lib 的 browser
				// 导出条件);`<name>/src` 子路径对到源码目录,供共享代码引用。
				// 子路径键必须先插入——别名解析按插入序取首个命中项
				const clientEntry = `${dir}/client/index.ts`;
				if (existsSync(`${dir}/src`)) aliases[`${name}/src`] = `${dir}/src`;
				aliases[name] = existsSync(clientEntry) ? clientEntry : `${dir}/src`;
			} catch {}
		}
	}
	return aliases;
}

const workspaceAliases = collectWorkspaceAliases();

export async function build(root: string, config: vite.UserConfig = {}) {
	if (!existsSync(root + "/client")) return;

	const outDir = root + "/dist";
	if (existsSync(outDir)) {
		await fs.rm(outDir, { recursive: true });
	}
	await fs.mkdir(root + "/dist", { recursive: true });

	const results = (await vite.build(
		vite.mergeConfig(
			{
				root,
				build: {
					write: false,
					outDir: "dist",
					assetsDir: "",
					minify: true,
					emptyOutDir: true,
					commonjsOptions: {
						strictRequires: true,
					},
					lib: {
						entry: root + "/client/index.ts",
						fileName: "index",
						formats: ["es"],
					},
					rollupOptions: {
						makeAbsoluteExternalsRelative: true,
						external: [
							"vue",
							"vue-router",
							"@vueuse/core",
							"@koishi-ce/client",
						],
						output: {
							format: "iife",
						},
					},
				},
				plugins: [
					vue(),
					yaml(),
					(
						await import("unocss/vite")
					).default({
						presets: [
							(
								await import("unocss/preset-mini")
							).default({
								preflight: false,
							}),
						],
					}),
				],
				css: {
					preprocessorOptions: {
						scss: {
							api: "modern-compiler",
						},
					},
				},
				resolve: {
					alias: {
						...workspaceAliases,
						"vue-i18n": "@koishi-ce/client",
						"@koishi-ce/components": "@koishi-ce/client",
						// 虚拟子路径,类型见 packages/web/components/client/shims.d.ts
						"schemastery-vue/client": "schemastery-vue",
					},
				},
				define: {
					"process.env.NODE_ENV": '"production"',
				},
			} as vite.InlineConfig,
			config,
		),
	)) as BuildResult[];

	for (const item of results[0]!.output) {
		if (item.fileName === "index.mjs") item.fileName = "index.js";
		const dest = root + "/dist/" + item.fileName;
		if (item.type === "asset") {
			await fs.writeFile(dest, item.source);
		} else {
			const result = await vite.transformWithEsbuild(item.code!, dest, {
				minifyWhitespace: true,
				charset: "utf8",
			});
			await fs.writeFile(dest, result.code);
		}
	}
}

export async function createServer(
	baseDir: string,
	config: vite.InlineConfig = {},
) {
	const root = resolve(__dirname, "../app");
	return vite.createServer(
		vite.mergeConfig(
			{
				root,
				base: "/vite/",
				server: {
					middlewareMode: true,
					fs: {
						allow: [vite.searchForWorkspaceRoot(baseDir)],
					},
				},
				plugins: [
					vue(),
					yaml(),
					(await import("unocss/vite")).default({
						presets: [
							(await import("unocss/preset-mini")).default({
								preflight: false,
							}),
						],
					}),
				],
				css: {
					preprocessorOptions: {
						scss: {
							api: "modern-compiler",
						},
					},
				},
				resolve: {
					dedupe: [
						"vue",
						"vue-demi",
						"vue-router",
						"element-plus",
						"@vueuse/core",
						"@popperjs/core",
						"marked",
						"xss",
					],
					alias: {
						// for backward compatibility
						"../client.js": "@koishi-ce/client",
						"../vue.js": "vue",
						"../vue-router.js": "vue-router",
						"../vueuse.js": "@vueuse/core",
						// 虚拟子路径,类型见 packages/web/components/client/shims.d.ts
						"schemastery-vue/client": "schemastery-vue",
					},
				},
				optimizeDeps: {
					include: [
						"vue",
						"vue-router",
						"element-plus",
						"@vueuse/core",
						"@popperjs/core",
						"marked",
						"xss",
					],
				},
				build: {
					rollupOptions: {
						input: root + "/index.html",
					},
				},
			} as vite.InlineConfig,
			config,
		),
	);
}
