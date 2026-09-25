// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 宿主控制台前端的总装构建（编程式 vite.build，本仓库没有 vite 配置文件）。
 *
 * 是 `koishi-console build` 的无参分支（src/bin.ts）背后的实现。
 * 产物目录硬编码为 `plugins/webui/console/dist/`，内容分四部分：
 * - 宿主 SPA（`@koishi-ce/console-app` 包，经 `locateApp()` 定位）→ `index.js`
 * - client 组件库（`@koishi-ce/client` 的 `src/` 目录）→ `client.js`（element-plus 单独成 chunk）
 * - vue / vue-router / @vueuse/core 三个运行时共享包 → `vue.js` 等，
 *   供主应用、client 与所有 webui 插件以 external 依赖的方式共享
 */

import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import mini from "unocss/preset-mini";
import unocss from "unocss/vite";
import * as vite from "vite";
import { locateApp } from "./app.ts";
import { iconsPlugin } from "./icons.ts";
import { yaml } from "./yaml.ts";

// vite 8 基于 rolldown,rollup 已不在依赖树中;这里按实际消费的字段
// 局部声明构建产物类型(与 src/index.ts 的 BuildResult 同构)
interface BuildResult {
	output: Array<{
		fileName: string;
		type: string;
		name?: string;
		source?: string | Uint8Array;
		code?: string;
	}>;
}

/**
 * 定位某个依赖包在 node_modules 中的安装目录。
 *
 * @param id 依赖包名（须能被 Bun.resolveSync 解析到）
 * @returns 形如 `<前缀>/node_modules/<id>` 的目录路径（统一为正斜杠）
 */
function findModulePath(id: string) {
	const path = Bun.resolveSync(id, import.meta.dir).replace(
		/\\/g,
		"/",
	);
	const keyword = `/node_modules/${id}/`;
	return (
		path.slice(0, path.indexOf(keyword)) +
		keyword.slice(0, -1)
	);
}

// 源码 src/ 与打包后 lib/ 到仓库根的深度一致（四级），两种运行
// 形态下相对定位结果相同
const cwd = resolve(import.meta.dir, "../../../..");

/**
 * 校验按层数推导出的仓库根确实成立。
 *
 * 总装的产物落点在另一个包内（`plugins/webui/console/dist`），只能在
 * 仓库形态下执行：下游 npm 安装形态下四级上跳落在无关目录，此时显式
 * 报错，而不是把产物写到无关路径。
 */
function assertRepoLayout(): void {
	if (existsSync(`${cwd}/package.json`)) return;
	throw new Error(
		`宿主总装只能在仓库内执行：未能从 ${import.meta.dir} 定位到仓库根。` +
			"构建单个插件前端请改用 `koishi-console build <插件目录>`。",
	);
}

/** 宿主控制台总装的产物落点（console 宿主包内的 dist）。 */
const dist = `${cwd}/plugins/webui/console/dist`;

/**
 * 通用构建函数：以 `root` 为构建根目录打一个 ES 模块包到 console dist。
 *
 * @param root 构建根目录（决定默认入口与 html 所在位置）
 * @param config 额外的 vite 配置，逐层合并覆盖下方默认值
 * @param isClient 标记本次构建的是否为 client 组件库本体。仅该构建需要
 *   真实打包 vue-i18n（见下方别名说明），其余构建一律复用宿主的 client.js
 * @returns rollup 构建结果（供调用方进一步处理产物）
 */
async function build(
	root: string,
	config: vite.UserConfig = {},
	isClient = false,
) {
	const { rollupOptions = {} } = config.build || {};
	return (await vite.build({
		root,
		build: {
			outDir: dist,
			emptyOutDir: true,
			// 样式合并为单个 style.css，方便服务端一次性下发
			cssCodeSplit: false,
			// element-plus 全家桶打出的 element.js 约 870 kB，默认 500 kB 的
			// 上报阈值对这个体量的控制台总装必然触发，放宽到 1 MB
			chunkSizeWarningLimit: 1024,
			...config.build,
			rollupOptions: {
				...rollupOptions,
				makeAbsoluteExternalsRelative: true,
				// 各 root 下预置的共享包文件（vue.js / client.js 等）视为外部依赖，
				// 产物以相对路径引用它们而非打包进来
				external: [
					`${root}/vue.js`,
					`${root}/vue-router.js`,
					`${root}/client.js`,
					`${root}/vueuse.js`,
				],
				output: {
					format: "module",
					entryFileNames: "[name].js",
					chunkFileNames: "[name].js",
					assetFileNames: "[name].[ext]",
					...rollupOptions.output,
				},
			},
		},
		plugins: [
			// 图标虚拟模块（~icons/k/*）的编译期转换，见 icons.ts
			await iconsPlugin(),
			// 钉死剥离模板注释：注释写在 template 根元素之前时，SFC 会被
			// 编译成多根 fragment，Vue 随之禁用 attribute 透传（外部传入的
			// class 落不到 svg 上，侧栏图标因此丢掉尺寸类）；生产语义本就
			// 应剥注释，这里显式钉死，避免随 NODE_ENV 漂移
			vue({
				template: {
					compilerOptions: { comments: false },
				},
			}),
			yaml(),
			...(config.plugins || []),
		],
		resolve: {
			alias: {
				vue: `${root}/vue.js`,
				"vue-router": `${root}/vue-router.js`,
				"@vueuse/core": `${root}/vueuse.js`,
				"@koishi-ce/client": `${root}/client.js`,
				// 虚拟子路径的运行时载体（补齐真实包缺失的 SchemaBase 具名
				// 导出，见 packages/web/components/src/schemastery-vue-runtime.ts）；
				// 类型面由根 tsconfig.client.json 的 paths 解析到类型载体
				"schemastery-vue/client": `${cwd}/packages/web/components/src/schemastery-vue-runtime.ts`,
				...(isClient
					? {
							// client 组件库本体需要真实打包 vue-i18n：直接别名到官方
							// esm-browser.prod 预编译产物（面向浏览器 ESM 且自带压缩，
							// @intlify/core-base 已内联其中，无需额外处理）
							"vue-i18n":
								findModulePath("vue-i18n") +
								"/dist/vue-i18n.esm-browser.prod.js",
						}
					: {
							// 其余构建（主应用等）不打包 vue-i18n，运行时复用宿主的 client.js
							"vue-i18n": `${root}/client.js`,
						}),
			},
		},
	})) as BuildResult;
}

export default async function () {
	assertRepoLayout();
	// 第一步：构建控制台主应用（入口为 app 包的 src/index.html，产物 index.js）
	const { output } = await build(locateApp(), {
		plugins: [
			unocss({
				presets: [
					mini({
						// 宿主 html 已自带基础样式，这里关掉 unocss 的全局 reset
						preflight: false,
					}),
				],
			}),
		],
	});

	// 第二步：三个运行时共享包。vue 直接复制官方 runtime esm-browser 产物；
	// vue-router 与 @vueuse/core 以各自官方浏览器产物为入口重新打包，
	// preserveEntrySignatures: "strict" 保留入口导出签名供具名导入
	await Promise.all([
		Bun.write(
			`${dist}/vue.js`,
			Bun.file(
				`${findModulePath("vue")}/dist/vue.runtime.esm-browser.prod.js`,
			),
		),
		build(`${findModulePath("vue-router")}/dist`, {
			build: {
				outDir: dist,
				emptyOutDir: false,
				rollupOptions: {
					input: {
						"vue-router": `${findModulePath("vue-router")}/dist/vue-router.esm-browser.js`,
					},
					preserveEntrySignatures: "strict",
				},
			},
		}),
		build(findModulePath("@vueuse/core"), {
			build: {
				outDir: dist,
				emptyOutDir: false,
				rollupOptions: {
					// @vueuse/core v14 起的 ESM 入口位于 dist/index.js
					// （v11 时代是包根的 index.mjs，v15 沿用 dist 形态）
					input: {
						vueuse: `${findModulePath("@vueuse/core")}/dist/index.js`,
					},
					preserveEntrySignatures: "strict",
				},
			},
		}),
	]);

	// 第三步：构建 client 组件库（isClient = true，打包真实 vue-i18n）；
	// element-plus 体积大，单独拆为 element chunk
	await build(
		`${cwd}/packages/web/client/src`,
		{
			build: {
				outDir: dist,
				emptyOutDir: false,
				rollupOptions: {
					input: {
						client: `${cwd}/packages/web/client/src/index.ts`,
					},
					output: {
						// element-plus 体积大，单独拆为 element chunk
						manualChunks(id: string) {
							return id.includes("element-plus")
								? "element"
								: undefined;
						},
					},
					preserveEntrySignatures: "strict",
				},
			},
		},
		true,
	);

	// client 构建会用自己的一份 style.css 覆盖主应用先前写出的同名文件，
	// 因此这里把主应用构建（留在内存 output 中）的样式追加到文件末尾，
	// 使最终 style.css 同时包含两者
	for (const file of output) {
		if (
			file.type === "asset" &&
			file.name === "style.css"
		) {
			if (file.source === undefined) continue;
			await appendFile(`${dist}/style.css`, file.source);
		}
	}
}
