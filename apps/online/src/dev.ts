/**
 * k-on! 的本地开发服务器：Koa 静态服务 + 编程式 Vite（middlewareMode），
 * 监听 3000 端口。
 *
 * 它在本机完整模拟了生产环境中 registry.koishi.chat 承担的在线化链路：
 * - /portable.json：用 LocalScanner 扫描本地插件生成市场索引，对应线上
 *   注册表的同名接口；
 * - /modules/*：把在线模块请求重定向到 /vite/@fs/<源码绝对路径>，交由
 *   Vite 即时编译——相当于把"在线模块注册表"换成"本地源码 + 热更新"。
 *
 * 页面注入的 KOISHI_CONFIG 里 endpoint 为空字符串（见 transformHtml），
 * app/loader.ts 因此回源到当前站点而非远程注册表。
 */
import Router from "@koa/router";
import { LocalScanner } from "@koishi-ce/registry";
import { noop } from "@koishi-ce/utils";
import yaml from "@maikolib/vite-plugin-yaml";
import { createReadStream, type Stats } from "fs";
import { readFile, stat } from "fs/promises";
import Koa from "koa";
import { createRequire } from "module";
import { dirname, extname, resolve } from "path";
import { load } from "tsconfig-utils";
import type { ViteDevServer } from "vite";

// package.json 的条件导出结构（exports 字段的递归形态）
interface PackageJsonExports {
	[key: string]: string | PackageJsonExports;
}

interface PackageJson {
	/** npm 包描述文件中与本服务相关的字段子集 */
	main?: string;
	module?: string;
	exports?: string | PackageJsonExports;
	/** koishi 插件约定的附加静态导出映射（多为 wasm 等资源文件） */
	koishi?: { exports?: Record<string, string> };
}

const app = new Koa();
const router = new Router();

app.use(router.routes());
app.use(router.allowedMethods());

// 开发态站点部署在根路径（线上由部署平台决定）
const uiPath = "";
const root = resolve(
	require.resolve("@koishi-ce/online/package.json"),
	"../app",
);

let vite: ViteDevServer;

/**
 * 通用静态文件路由（SPA 兜底）：先放行后续中间件（/modules、/vite 等
 * 专用路由优先匹配），未被处理时按路径读取 app/ 下的磁盘文件；路径限制
 * 在根目录内（防目录穿越）；既非文件、又无扩展名（或为 .html）的路径
 * 返回注入过开发配置的 index.html，交给前端路由。
 */
router.get(uiPath + "(/.+)*", async (koa, next) => {
	await next();
	if (koa.body || koa.response.body) return;

	// 根路径补上尾部斜杠并重定向（保证相对路径资源可正确解析）
	if (koa.path === uiPath && !uiPath.endsWith("/")) {
		return koa.redirect(koa.path + "/");
	}
	const name = koa.path.slice(uiPath.length).replace(/^\/+/, "");
	const sendFile = (filename: string) => {
		koa.type = extname(filename);
		return (koa.body = createReadStream(filename));
	};
	const filename = resolve(root, name);
	if (!filename.startsWith(root) && !filename.includes("node_modules")) {
		return (koa.status = 403);
	}
	const stats = await stat(filename).catch<Stats>(noop);
	if (stats?.isFile()) return sendFile(filename);
	const ext = extname(filename);
	if (ext && ext !== ".html") return (koa.status = 404);
	const template = await readFile(resolve(root, "index.html"), "utf8");
	koa.type = "html";
	koa.body = await transformHtml(template);
});

const scanner = new LocalScanner(__dirname);

/**
 * 市场索引接口：模拟 registry.koishi.chat 的 portable.json。扫描本地
 * 插件后，与线上行为保持一致地清空贡献者 / 维护者 / 链接等在线环境
 * 用不到的字段以精简体积。
 */
router.get("/portable.json", async (ctx) => {
	await scanner.collect();
	for (const object of scanner.objects) {
		object.package.contributors = [];
		object.package.maintainers = [];
		object.package.links = {};
	}
	ctx.body = scanner;
});

/**
 * 按 browser > import > default > "." 的优先级递归展开 package.json 的
 * 条件导出（exports）字段，返回最终命中的入口相对路径。
 */
function getConditionalExport(exports: string | PackageJsonExports) {
	if (typeof exports === "string") return exports;
	for (const key of ["browser", "import", "default", "."]) {
		const value = exports[key];
		if (value) return getConditionalExport(value);
	}
	return undefined;
}

/**
 * 推断一个包在浏览器侧的入口文件：优先取 exports 条件导出，其次
 * module，再次 main，最后回退 index.js。Vite 不接管这些包的正常解析，
 * 需手动还原入口路径后才能交给它编译。
 */
function getExport(meta: PackageJson): string {
	if (meta.exports) {
		return getConditionalExport(meta.exports) ?? "index.js";
	} else if (typeof meta.module === "string") {
		return meta.module;
	} else if (typeof meta.main === "string") {
		return meta.main;
	} else {
		return "index.js";
	}
}

/**
 * 在线模块接口（开发态）：对应线上的 https://registry.koishi.chat/modules/...，
 * 是浏览器端 loader 动态 import 的实际落点。
 *
 * 请求 <包名>/index.js 时：解析该包的入口，若入口位于构建产物目录
 * （tsconfig 的 outDir），则依据 rootDir 反算回 .ts 源文件，最后把请求
 * 302 到 /vite/@fs/<绝对路径>，由下方挂载的 Vite 中间件即时编译返回。
 * 请求其它文件名时：查包内 koishi.exports 映射原样返回对应静态资源。
 */
router.get("/modules(/.+)+", async (ctx) => {
	const parts = (ctx.params[0] ?? "").slice(1).split("/");
	let name = parts.shift() ?? "";
	if (name.startsWith("@")) name += "/" + (parts.shift() ?? "");
	const filename = parts.join("/");
	const metafile = require.resolve(name + "/package.json");
	const cwd = resolve(metafile, "..");
	const meta = (await readFile(metafile, "utf8").then(
		JSON.parse,
	)) as PackageJson;
	if (filename === "index.js") {
		const config = await load(cwd);
		const {
			rootDir = ".",
			outFile,
			outDir = outFile ? dirname(outFile) : ".",
		} = config.compilerOptions;
		let entry = getExport(meta);
		if (entry.startsWith("./")) entry = entry.slice(2);
		if (entry.startsWith(outDir + "/")) {
			const outExt = extname(entry);
			entry = resolve(
				cwd,
				rootDir,
				entry.slice(outDir.length + 1, -outExt.length) + ".ts",
			);
		} else {
			entry = resolve(cwd, entry);
		}
		ctx.redirect(`/vite/@fs${entry}`);
	} else {
		const entry = meta["koishi"]?.exports?.[filename];
		if (!entry) {
			ctx.status = 404;
			return;
		}
		const require = createRequire(metafile);
		ctx.body = createReadStream(require.resolve(entry));
		ctx.type = "application/wasm";
	}
});

/**
 * 同路径注册的旧版 /modules 路由：仅保留"包名 -> 源码入口重定向"一段
 * 逻辑。上一个路由的所有分支都直接 return、从不调用 next()，此处在
 * koa-router 的中间件链中实际不会被执行，属历史遗留；保留备查，
 * 勿在此追加新逻辑。
 */
router.get("/modules(/.+)+", async (ctx) => {
	const name = ctx.params[0] ?? "";
	const metapath = require.resolve(name + "/package.json");
	const cwd = resolve(metapath, "..");
	const meta = (await readFile(metapath, "utf8").then(
		JSON.parse,
	)) as PackageJson;
	const config = await load(cwd);
	const {
		rootDir = ".",
		outFile,
		outDir = outFile ? dirname(outFile) : ".",
	} = config.compilerOptions;
	let entry = getExport(meta);
	if (entry.startsWith("./")) entry = entry.slice(2);
	if (entry.startsWith(outDir + "/")) {
		const outExt = extname(entry);
		entry = resolve(
			cwd,
			rootDir,
			entry.slice(outDir.length + 1, -outExt.length) + ".ts",
		);
	} else {
		entry = resolve(cwd, entry);
	}
	ctx.redirect(`/vite/@fs${entry}`);
});

/**
 * 对 index.html 做 Vite 开发态转换（注入模块脚本等），再内联
 * KOISHI_CONFIG：devMode 为 true、endpoint 为空字符串——运行时的一切
 * 数据与模块请求都回到本服务器，而不指向远程注册表（对照生产构建：
 * src/build.ts 的 configPlugin 注入的是 registry.koishi.chat）。
 */
async function transformHtml(template: string) {
	template = await vite.transformIndexHtml(uiPath, template);
	const headInjection = `<script>KOISHI_CONFIG = ${JSON.stringify({
		static: true,
		devMode: true,
		uiPath,
		endpoint: "",
	})}</script>`;
	return template.replace("</title>", "</title>" + headInjection);
}

/**
 * 以 middlewareMode 创建 Vite 开发服务器并挂载到 /vite/* 路由。
 *
 * resolve.alias 完成两件事：
 * - 当仓库内存在 koishi / minato 源码时，把核心包指回各自的 src/
 *   入口，保证调试走源码而非产物；
 * - 把 fs / path / os / dns / url 等 Node 内置模块与 chokidar 重写到
 *   浏览器端实现源码（生产环境对应 @cordiverse/* 系在线模块，见
 *   src/build.ts 的 shims）。
 * define 固定 process.* 的形态，模拟浏览器宿主环境。
 */
async function createVite() {
	const { createServer } = require("vite") as typeof import("vite");
	const { default: vue } =
		require("@vitejs/plugin-vue") as typeof import("@vitejs/plugin-vue");

	vite = await createServer({
		root,
		base: "/vite/",
		cacheDir: resolve(__dirname, "../.cache"),
		server: {
			middlewareMode: true,
			fs: {
				strict: false,
			},
		},
		plugins: [vue(), yaml() as any],
		resolve: {
			extensions: [".ts", ".js", ".json", ".yml", ".yaml"],
			dedupe: [
				"vue",
				"vue-demi",
				"vue-router",
				"element-plus",
				"@vueuse/core",
				"@popperjs/core",
			],
			alias: {
				...(require.resolve("@root/koishi/package.json")
					? {
							"@koishi-ce/core": "@koishi-ce/core/src/index.ts",
							"@koishi-ce/loader": "@koishi-ce/loader/src/shared.ts",
						}
					: {}),
				...(require.resolve("@root/minato/package.json")
					? {
							"@minatojs/driver-sqlite": "@minatojs/driver-sqlite/src/index.ts",
							"@minatojs/sql-utils": "@minatojs/sql-utils/src/index.ts",
							minato: "minato/src/index.ts",
						}
					: {}),
				"@koishi-ce/plugin-console":
					"@koishi-ce/plugin-console/src/browser/index.ts",
				chokidar: "@koishijs/fs/src/index.ts",
				"dns/promises": "@koishijs/dns/src/promises.ts",
				dns: "@koishijs/dns/src/index.ts",
				"fs/constants": "@koishijs/fs/src/constants.ts",
				"fs/promises": "@koishijs/fs/src/promises.ts",
				fs: "@koishijs/fs/src/index.ts",
				os: "@koishijs/os/src/index.ts",
				path: "@koishijs/path/src/index.ts",
				url: "@koishijs/url/src/index.ts",
			},
		},
		define: {
			"process.cwd": '() => "/"',
			"process.env.NODE_ENV": JSON.stringify("development"),
			"process.env.KOISHI_BASE": "null",
			"process.env.KOISHI_ENV": JSON.stringify("browser"),
		},
		optimizeDeps: {
			include: [
				"schemastery",
				"element-plus",
				"supports-color",
				"marked",
				"xss",
				"semver",
				"spark-md5",
			],
		},
		build: {
			rollupOptions: {
				input: root + "/index.html",
			},
		},
	});

	router.all(
		"/vite(/.+)*",
		(ctx) =>
			new Promise((resolve) => {
				vite.middlewares(ctx.req, ctx.res, resolve);
			}),
	);

	return vite;
}

// 把 Vite 开发中间件桥接到 Koa（异步就绪，不阻塞下方监听）
void createVite();

app.listen(3000);
