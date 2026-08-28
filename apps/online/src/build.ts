/**
 * k-on!（Koishi Online，PPA 在线插件站）的生产构建脚本，全部走编程式
 * vite.build()，无独立配置文件。
 *
 * 核心构建 hack（PPA 在线化）：把 Koishi 运行时依赖（cordis、koishi、
 * @satorijs/* 等 builtins 清单）在构建期改写为
 * https://registry.koishi.chat/modules/<包名>/index.js 的在线模块 URL——
 * 产物不内置这些包，而是由浏览器在运行时按需从注册表动态 import。
 *
 * 整站构建分四步（见文件底部的默认导出）：
 * 1. app/ 目录：站点自身的页面与入口；
 * 2. 三个共享运行时单文件：vue（直接拷贝浏览器 prod 产物）、vue-router、
 *    @vueuse/core（重打包为保留导出签名的单入口）；
 * 3. packages/web/client/client：宿主控制台前端（@koishi-ce/client）；
 * 4. 把第 1 步产出的站点样式追加进总 style.css。
 */
import yaml from "@maikolib/vite-plugin-yaml";
import vue from "@vitejs/plugin-vue";
import { appendFile, copyFile } from "fs/promises";
import { resolve } from "path";
import * as vite from "vite";
import type { RollupOutput } from "vite/types/internal/rollupTypeCompat";

/**
 * 定位某个依赖包在 node_modules 中的安装目录。
 *
 * 借助 require.resolve 取得包内文件的绝对路径，再回溯截取到
 * `<上级目录>/node_modules/<包名>` 这一层；路径分隔符统一为 `/`，
 * 以便后续拼接产物 URL 与匹配 external。
 *
 * @param id 包名（须可被当前包解析，如 "vue"、"@vueuse/core"）
 * @returns 该包的 node_modules 目录绝对路径（不含结尾斜杠）
 */
function findModulePath(id: string) {
	const path = require.resolve(id).replace(/\\/g, "/");
	const keyword = `/node_modules/${id}/`;
	return path.slice(0, path.indexOf(keyword)) + keyword.slice(0, -1);
}

/**
 * 向 index.html 注入站点运行所需的头部片段：
 * - PWA 的 manifest 链接；
 * - 内联脚本 KOISHI_CONFIG——控制台前端的全局配置，其中 endpoint 固定为
 *   https://registry.koishi.chat，即本站的市场数据与在线模块统一从该注册表
 *   加载（PPA 在线化的运行时入口，对应 app/loader.ts 的 prepare）。
 */
const configPlugin: vite.Plugin = {
	name: "config",
	transformIndexHtml(template) {
		const headInjection = [
			'<link rel="manifest" href="/manifest.json">',
			`<script>KOISHI_CONFIG = ${JSON.stringify({
				static: true,
				uiPath: "/",
				endpoint: "https://registry.koishi.chat",
			})}</script>`,
		]
			.map((line) => "\n    " + line)
			.join("");
		return template.replace("</title>", "</title>" + headInjection);
	},
};

// 仓库根目录与产物输出目录（apps/online/dist，即部署到线上的站点根）
const cwd = resolve(__dirname, "../../..");
const dist = cwd + "/apps/online/dist";

/**
 * 构建期"外置"的内置模块清单：这些依赖一律不打包进产物，而是改写为
 * registry.koishi.chat 上的在线模块 URL（见 toExternal），由浏览器运行时
 * 按需 import。其中 dns / fs / path / process 是 Node 内置模块名——
 * Koishi 及其插件以同名 import 它们，构建时经 shims 换成浏览器实现包后
 * 同样走在线加载。
 */
const builtins = [
	"@koishi-ce/core",
	"@satorijs/core",
	"@satorijs/elements",
	"cordis",
	"dns",
	"fs",
	"js-yaml",
	"koishi",
	"reggol",
	"schemastery",
	"process",
	"path",
];

/**
 * Node 内置模块名到浏览器垫片包名的映射：@cordiverse/* 系列在浏览器里
 * 提供同名能力（fs 实际读写内存虚拟文件系统）。在线模块 URL 使用垫片
 * 包名而非 Node 保留名。
 */
const shims = {
	dns: "@cordiverse/dns",
	fs: "@cordiverse/fs",
	path: "@cordiverse/path",
};

/**
 * 把模块名改写为注册表的在线模块 URL——PPA 在线化的核心改写规则，
 * 同时用于 rollup 的 external（产物中保留 import 语句）与 resolve.alias
 * （构建期依赖解析的重定向）。
 *
 * @param name builtins 清单中的任一模块名
 * @returns 形如 https://registry.koishi.chat/modules/<模块名>/index.js 的 URL
 */
function toExternal(name: string) {
	return (
		"https://registry.koishi.chat/modules/" +
		(shims[name as keyof typeof shims] ?? name) +
		"/index.js"
	);
}

/**
 * 以编程式方式执行一次 vite 构建。
 *
 * 为满足在线化与注册表式引用，与常规构建的差异：
 * - rollup external：vue / vue-router / client / vueuse 四个共享运行时
 *   指向站点根下的既有单文件；builtins 全部换成在线模块 URL，产物中保留
 *   import 语句而非打入代码；
 * - resolve.alias：源码里的同名导入在构建期直接改写到上述目标；
 * - 输出为平铺的单文件名（无 hash、不拆 chunk）；
 * - cssCodeSplit 关闭，样式合并为单个 style.css。
 *
 * @param root 构建根目录（入口所在目录）
 * @param config 追加 / 覆盖的 vite 配置（可覆盖 build 相关字段）
 * @returns 构建产物描述（RollupOutput）
 */
export async function build(root: string, config: vite.UserConfig = {}) {
	const { rollupOptions = {} } = config.build || {};
	return (await vite.build({
		root,
		build: {
			outDir: cwd + "/apps/online/dist",
			emptyOutDir: true,
			cssCodeSplit: false,
			...config.build,
			rollupOptions: {
				...rollupOptions,
				makeAbsoluteExternalsRelative: true,
				external: [
					root + "/vue.js",
					root + "/vue-router.js",
					root + "/client.js",
					root + "/vueuse.js",
					...builtins.map(toExternal),
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
		plugins: [vue() as any, yaml(), configPlugin],
		resolve: {
			alias: {
				vue: root + "/vue.js",
				"vue-router": root + "/vue-router.js",
				"@vueuse/core": root + "/vueuse.js",
				"@koishi-ce/client/app": "@koishi-ce/client/app",
				"@koishi-ce/client": root + "/client.js",
				...Object.fromEntries(builtins.map((id) => [id, toExternal(id)])),
			},
		},
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
		},
	})) as RollupOutput;
}

/**
 * 整站构建入口（`src/build.ts` 的执行体），步骤见文件头注释。
 * 注意第 2 步起均为 emptyOutDir: false 的追加式输出，只有第一步会清空
 * dist 目录，因此各步顺序不可调换。
 */
export default async function () {
	// 第 1 步：构建 k-on! 站点自身（play 主入口），产出页面入口与样式
	const { output } = await build(cwd + "/apps/online/app");

	await Promise.all([
		copyFile(
			findModulePath("vue") + "/dist/vue.runtime.esm-browser.prod.js",
			dist + "/vue.js",
		),
		build(findModulePath("vue-router") + "/dist", {
			build: {
				outDir: dist,
				emptyOutDir: false,
				rollupOptions: {
					input: {
						"vue-router":
							findModulePath("vue-router") + "/dist/vue-router.esm-browser.js",
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
					input: {
						vueuse: findModulePath("@vueuse/core") + "/index.mjs",
					},
					preserveEntrySignatures: "strict",
				},
			},
		}),
	]);

	await build(cwd + "/packages/web/client/client", {
		build: {
			outDir: dist,
			emptyOutDir: false,
			rollupOptions: {
				input: {
					client: cwd + "/packages/web/client/client/index.ts",
				},
				output: {
					// rolldown 的 manualChunks 仅接受函数形式（对象形式为其拒绝的类型），
					// 这里按 rollup 对象配置的语义改写为等价函数
					manualChunks(id) {
						return id.includes("element-plus") ? "element" : null;
					},
				},
				preserveEntrySignatures: "strict",
			},
		},
	});

	// 第 4 步：dist/style.css 此时是宿主 client 构建生成的样式，
	// 把第 1 步站点产物里的同名样式追加到其末尾，两段样式才能同时生效
	for (const file of output) {
		if (file.type === "asset" && file.name === "style.css") {
			await appendFile(dist + "/style.css", file.source);
		}
	}
}
