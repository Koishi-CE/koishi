// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * @koishi-ce/client 构建入口。
 *
 * 提供两个编程式 API（本仓库的前端构建没有 vite 配置文件，全部在此完成）：
 * - `build(root)`：构建单个 webui 插件的前端（`<插件目录>/client/` → `dist/`），
 *   由 `koishi-console` CLI（src/bin.ts）暴露给各插件使用；
 * - `createServer(baseDir)`：创建开发模式的 vite 中间件服务器。
 */

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vue from "@vitejs/plugin-vue";
import * as vite from "vite";
import { yaml } from "./yaml.ts";

// vite 8 基于 rolldown,rollup 已不在依赖树中;这里按实际消费的字段
// 局部声明构建产物类型(替代原先的 `import type { RollupOutput }`)
interface BuildResult {
	output: Array<{
		fileName: string;
		type: string;
		source?: string | Uint8Array;
		code?: string;
	}>;
}

// 将全部工作区包名映射到其源码目录,行为对齐根 tsconfig 的 paths 别名。
// 没有被任何工作区包依赖的插件(如 plugin-logger)不会出现在 node_modules
// 的链接里,bundler 无法按包名解析,必须显式提供这层映射。
async function collectWorkspaceAliases(): Promise<
	Record<string, string>
> {
	// 源码形态(src/)与产物形态(lib/)都在包根下一级,上跳四级到仓库根一致
	const repoRoot = resolve(
		import.meta.dir,
		"../../../..",
	).replace(/\\/g, "/");
	const manifest = await Bun.file(
		`${repoRoot}/package.json`,
	).json();
	const aliases: Record<string, string> = {};
	for (const pattern of manifest.workspaces ?? []) {
		// scanSync 产出的相对路径在 Windows 上是反斜杠,统一归一化为正斜杠
		const files = new Bun.Glob(
			`${pattern}/package.json`,
		).scanSync({
			cwd: repoRoot,
		});
		for (const file of files) {
			const rel = file.replaceAll("\\", "/");
			const dir = `${repoRoot}/${rel.slice(0, -"/package.json".length)}`;
			try {
				const { name } = await Bun.file(
					`${dir}/package.json`,
				).json();
				if (!name) continue;
				// 控制台前端语境下,裸包名对到浏览器端入口(替代上游 lib 的 browser
				// 导出条件);`<name>/src` 子路径对到源码目录,供共享代码引用;
				// `<name>/client` 子路径对到浏览器端入口(上游生态以该子路径跨插件
				// 引用彼此的 client API,如 market 引用 config 的 EnvInfo 类型,
				// 上游与 npm 产物的 exports 均未声明它,同样靠仓库内别名解析)。
				// 子路径键必须先插入——别名解析按插入序取首个命中项
				const clientEntry = `${dir}/client/index.ts`;
				if (existsSync(`${dir}/src`))
					aliases[`${name}/src`] = `${dir}/src`;
				if (existsSync(clientEntry))
					aliases[`${name}/client`] = clientEntry;
				aliases[name] = existsSync(clientEntry)
					? clientEntry
					: `${dir}/src`;
			} catch {}
		}
	}
	return aliases;
}

const workspaceAliases = await collectWorkspaceAliases();

// 虚拟子路径 "schemastery-vue/client" 的运行时载体（补齐真实包缺失的
// SchemaBase 具名导出）绝对路径，从 components 包的工作区别名推导；
// 类型面由根 tsconfig.client.json 的 paths 解析到 schemastery-vue-client.ts
const runtimeShimPath = (
	workspaceAliases["@koishi-ce/components"] ?? ""
).replace(
	/client\/index\.ts$/,
	"client/schemastery-vue-runtime.ts",
);

/**
 * 构建单个 webui 插件的前端产物。
 *
 * @param root 插件目录（无 `client/` 子目录时视为该插件没有前端，直接跳过）
 * @param config 额外的 vite 配置，逐层合并覆盖下方默认值
 */
export async function build(
	root: string,
	config: vite.UserConfig = {},
) {
	if (!existsSync(`${root}/client`)) return;

	// 插件可自带 `build/client.ts` 导出额外的 vite 配置覆盖下方默认值
	// （vite 只自动发现 vite.config.*，不会加载该路径，须在此显式接线），
	// 如 analytics 的 fuck-echarts 符号遮蔽修补
	const overridePath = `${root}/build/client.ts`;
	if (existsSync(overridePath)) {
		const mod = await import(
			pathToFileURL(overridePath).href
		);
		config = vite.mergeConfig(config, mod.default ?? mod);
	}

	// 产物约定：固定写入插件目录下的 dist/，清空后重建
	const outDir = `${root}/dist`;
	if (existsSync(outDir)) {
		await rm(outDir, { recursive: true });
	}
	await mkdir(outDir, { recursive: true });

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
						entry: `${root}/client/index.ts`,
						fileName: "index",
						formats: ["es"],
					},
					rollupOptions: {
						makeAbsoluteExternalsRelative: true,
						// unocss 全局模式插件在扫描阶段会对 "virtual:uno.css" 二次
						// resolve 并误报为多文件导入（单构建内即触发，与并发无关），
						// 仓库侧无法根治，直接静默
						onwarn(warning, warn) {
							if (
								warning.message.includes(
									"is being imported multiple times",
								)
							) {
								return;
							}
							warn(warning);
						},
						// 运行时由宿主控制台提供的共享依赖（vue.js / client.js 等），
						// 不打入插件产物，插件在浏览器中向宿主索取
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
					// 钉死剥离模板注释：注释写在 template 根元素之前时，SFC 会被
					// 编译成多根 fragment，Vue 随之禁用 attribute 透传（外部传入的
					// class 落不到 svg 上，侧栏图标因此丢掉尺寸类）；生产语义本就
					// 应剥注释，这里显式钉死，避免随 NODE_ENV 漂移。dev server
					// 同步钉死，保证开发态与产物行为一致
					vue({
						template: {
							compilerOptions: { comments: false },
						},
					}),
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
				resolve: {
					alias: {
						...workspaceAliases,
						// 插件侧不打包 vue-i18n 本体，运行时复用宿主 client 包
						// 再导出的实例（配合上面的 external 生效）
						"vue-i18n": "@koishi-ce/client",
						// 组件库同样经由宿主 client 包提供，避免每个插件
						// 都把整套组件库重复打进产物
						"@koishi-ce/components": "@koishi-ce/client",
						// market 插件的 client 依赖 npm 包 @koishijs/market（上游以
						// 源码发布的组件库），其内部以 npm 名引用组件库；重定向到
						// 本仓库同版本（1.5.22）components 源码，避免 npm 版整套
						// 组件库被打进插件产物
						"@koishijs/components":
							workspaceAliases["@koishi-ce/components"],
						// 虚拟子路径的运行时载体（补齐真实包缺失的 SchemaBase
						// 具名导出）；类型面由 tsconfig.client.json 的 paths
						// 解析到 schemastery-vue-client.ts
						"schemastery-vue/client": runtimeShimPath,
					},
				},
				define: {
					"process.env.NODE_ENV": '"production"',
				},
			} as vite.InlineConfig,
			config,
		),
	)) as BuildResult[];

	// build.write: false 让构建结果留在内存里，由这里手动落盘，
	// 以便对文件名和 JS 产物做后处理
	for (const item of results[0]?.output ?? []) {
		// lib es 格式的产物名是 index.mjs，统一改名为 index.js；css 产物
		// 默认名是 index.css，统一改名为 style.css（console 服务端的
		// resolveEntry 按该约定探测并下发）。rolldown 的 output 条目是
		// 冻结对象，不能原地改写
		let fileName = item.fileName;
		if (fileName === "index.mjs") fileName = "index.js";
		if (fileName === "index.css") fileName = "style.css";
		const dest = `${root}/dist/${fileName}`;
		if (item.type === "asset") {
			if (item.source === undefined) continue;
			await Bun.write(dest, item.source);
		} else if (item.code !== undefined) {
			// JS 产物再过一次 rolldown 的 minify：仅压缩空白、不动标识符
			// （compress/mangle 均由上面的 minify: true 完成），oxc 原生按
			// UTF-8 输出，中文等非 ASCII 字符不会被转义成 \u 序列。
			// 替代已废弃的 transformWithEsbuild（其 minifyWhitespace+charset
			// 组合在此等价于 compress:false + mangle:false 的默认 codegen）
			const { code } = await vite.minify(dest, item.code, {
				compress: false,
				mangle: false,
			});
			await Bun.write(dest, code);
		}
	}
}

/**
 * 创建开发模式下的 vite dev server（middlewareMode，不监听独立端口，
 * 由宿主 HTTP 服务挂载到 `/vite/` 前缀下）。
 *
 * @param baseDir 用于圈定文件访问范围的工作区根目录
 * @param config 额外的 vite 配置
 * @returns vite 的 ViteDevServer 实例
 */
export async function createServer(
	baseDir: string,
	config: vite.InlineConfig = {},
) {
	// 开发模式下以本包的 app/ 宿主应用为入口
	// （源码 src/ 与产物 lib/ 都在包根下一级，相对定位两者一致）
	const root = resolve(import.meta.dir, "../app");
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
					// 钉死剥离模板注释：注释写在 template 根元素之前时，SFC 会被
					// 编译成多根 fragment，Vue 随之禁用 attribute 透传（外部传入的
					// class 落不到 svg 上，侧栏图标因此丢掉尺寸类）；生产语义本就
					// 应剥注释，这里显式钉死，避免随 NODE_ENV 漂移。dev server
					// 同步钉死，保证开发态与产物行为一致
					vue({
						template: {
							compilerOptions: { comments: false },
						},
					}),
					yaml(),
					(await import("unocss/vite")).default({
						presets: [
							(await import("unocss/preset-mini")).default({
								preflight: false,
							}),
						],
					}),
				],
				resolve: {
					// 强制这些依赖全局单实例，避免不同副本并存导致
					// （例如多个 vue 实例）运行异常
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
						// 向后兼容：旧式插件以相对路径引用宿主共享包
						"../client.js": "@koishi-ce/client",
						"../vue.js": "vue",
						"../vue-router.js": "vue-router",
						"../vueuse.js": "@vueuse/core",
						// 虚拟子路径的运行时载体（同 build 的别名说明）
						"schemastery-vue/client": runtimeShimPath,
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
						input: `${root}/index.html`,
					},
				},
			} as vite.InlineConfig,
			config,
		),
	);
}
