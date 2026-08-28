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
	main?: string;
	module?: string;
	exports?: string | PackageJsonExports;
	koishi?: { exports?: Record<string, string> };
}

const app = new Koa();
const router = new Router();

app.use(router.routes());
app.use(router.allowedMethods());

const uiPath = "";
const root = resolve(
	require.resolve("@koishi-ce/online/package.json"),
	"../app",
);

let vite: ViteDevServer;

router.get(uiPath + "(/.+)*", async (koa, next) => {
	await next();
	if (koa.body || koa.response.body) return;

	// add trailing slash and redirect
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

router.get("/portable.json", async (ctx) => {
	await scanner.collect();
	for (const object of scanner.objects) {
		object.package.contributors = [];
		object.package.maintainers = [];
		object.package.links = {};
	}
	ctx.body = scanner;
});

function getConditionalExport(exports: string | PackageJsonExports) {
	if (typeof exports === "string") return exports;
	for (const key of ["browser", "import", "default", "."]) {
		const value = exports[key];
		if (value) return getConditionalExport(value);
	}
	return undefined;
}

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

void createVite();

app.listen(3000);
