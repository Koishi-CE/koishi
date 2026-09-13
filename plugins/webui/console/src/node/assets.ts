// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.
// upstream: koishijs/webui plugins/console/src/node/index.ts（serveAssets / transformHtml / getFiles 段；上游为单文件，本仓拆分时抽离至本文件，同步时以其整体 diff 对照本目录）

/**
 * 控制台前端静态资源托管（原 node/index.ts 的 serveAssets /
 * transformHtml / getFiles 方法拆出）。
 *
 * 原类方法以 this→console 参数化为模块函数，由 index.ts 的 NodeConsole
 * 薄委托调用；transformImport（裸导入改写）为类私有方法，经参数显式
 * 传入以维持类内可见性不变。
 */

import {
	createReadStream,
	existsSync,
	promises as fs,
	type Stats,
} from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { Entry } from "@koishi-ce/console";
import { h, makeArray, noop } from "@koishi-ce/koishi";
import type NodeConsole from "./index.ts";

/**
 * 取 entry 在当前模式下实际使用的文件列表：按 devMode 与 dev 路径是否
 * 存在回退。
 */
export function getFiles(
	files: Entry.Files,
	devMode?: boolean,
) {
	if (typeof files === "string" || Array.isArray(files))
		return files;
	if (!devMode) return files.prod;
	if (!existsSync(files.dev)) return files.prod;
	return files.dev;
}

/**
 * 处理 index.html 模板：devMode 交给 Vite 注入开发脚本，生产模式把
 * 根路径的 href/src 重写为 uiPath 前缀；随后在 <title> 前注入
 * KOISHI_CONFIG 全局配置与配置项 head 中的自定义标签。
 */
async function transformHtml(
	console: NodeConsole,
	template: string,
) {
	const { uiPath = "", head = [] } = console.config;
	if (console.vite) {
		template = await console.vite.transformIndexHtml(
			uiPath,
			template,
		);
	} else {
		template = template.replace(
			/(href|src)="(?=\/)/g,
			(_, $1) => `${$1}="${uiPath}`,
		);
	}
	let headInjection = `<script>KOISHI_CONFIG = ${JSON.stringify(console.createGlobal())}</script>`;
	for (const { tag, attrs = {}, content } of head) {
		const attrString = Object.entries(attrs)
			.map(
				([key, value]) =>
					` ${key}="${h.escape(value ?? "", true)}"`,
			)
			.join("");
		headInjection += `<${tag}${attrString}>${content ?? ""}</${tag}>`;
	}
	return template.replace(
		"<title>",
		`${headInjection}<title>`,
	);
}

/**
 * 注册控制台前端的静态资源路由（挂在 uiPath 下）：
 * - `@plugin-<key>/...`：各 webui 插件的产物文件；
 * - 其余路径：控制台主体资源，未命中文件时回退 index.html（SPA 路由）；
 * 插件产物的回读限制在其 entry 声明的产物路径内、主体资源限制在 root
 * 内，以防路径穿越。
 */
export function registerAssets(
	console: NodeConsole,
	transformImport: (source: string) => Promise<string>,
) {
	const { uiPath = "" } = console.config;

	console.ctx.server.get(
		`${uiPath}(.*)`,
		async (ctx, next) => {
			await next();
			if (ctx.body || ctx.response.body) return;

			// 访问 uiPath 本身时补上末尾斜杠并重定向（保证相对路径资源正确解析）
			if (ctx.path === uiPath && !uiPath.endsWith("/")) {
				return ctx.redirect(`${ctx.path}/`);
			}

			const name = ctx.path
				.slice(uiPath.length)
				.replace(/^\/+/, "");
			// 发送产物文件：JS 统一过裸导入改写（devMode 下 npm 安装的插件同样
			// 会回退到产物 URL，不能按 devMode 短路直出），其余类型直出；
			// 文件缺失时如实 404，避免流错误或回退 HTML 干扰排查
			const sendAsset = async (filename: string) => {
				const type = extname(filename);
				if (type === ".js" || type === ".mjs") {
					const source = await Bun.file(filename)
						.text()
						.catch(() => null);
					if (source === null) return (ctx.status = 404);
					ctx.type = type;
					return (ctx.body = await transformImport(source));
				}
				const stats = await fs
					.stat(filename)
					.catch<Stats>(noop);
				if (!stats?.isFile()) return (ctx.status = 404);
				ctx.type = type;
				return (ctx.body = createReadStream(filename));
			};

			if (name.startsWith("@plugin-")) {
				const [key] = name.slice(8).split("/", 1);
				if (key !== undefined && console.entries[key]) {
					const files = makeArray(
						getFiles(
							console.entries[key].files,
							console.config.devMode,
						),
					);
					const file = files[0];
					if (file === undefined) return (ctx.status = 404);
					// 防路径穿越：产物只允许位于该 entry 自身声明的文件（或目录）之内。
					// 上游以 console root / node_modules 为白名单基准，前提是插件装在
					// node_modules 下；本仓库插件为 workspace 目录布局（plugins/**），
					// 须以各 entry 的产物路径为基准，否则一律 403。
					const base = resolve(file);
					const filename = resolve(
						file + name.slice(8 + key.length),
					);
					if (
						filename !== base &&
						!filename.startsWith(base + sep)
					) {
						return (ctx.status = 403);
					}
					// devMode 下 entry 的源码形态由 Vite 经 /vite/@fs 编译服务，
					// @plugin 通道只服务构建产物；误达的源码请求直接 404
					if (
						console.config.devMode &&
						/\.(ts|tsx|vue)$/.test(filename)
					) {
						return (ctx.status = 404);
					}
					return sendAsset(filename);
				} else {
					return (ctx.status = 404);
				}
			}

			const filename = resolve(console.root, name);
			if (
				filename !== console.root &&
				!filename.startsWith(console.root + sep) &&
				!filename.includes("node_modules")
			) {
				return (ctx.status = 403);
			}

			const stats = await fs
				.stat(filename)
				.catch<Stats>(noop);
			if (stats?.isFile()) return sendAsset(filename);

			// 控制台主体未命中时，再到各插件产物目录按文件名兜底：插件产物里的
			// worker / 分包可能以根绝对路径引用（如 monaco 的 /editor.worker-*.js），
			// 这类请求不带 @plugin- 前缀，会落到主体分支；产物文件名通常带内容
			// 哈希，按 basename 在各 entry 目录内探测不会产生跨插件混淆
			const base = name.split("/").pop() ?? "";
			if (base) {
				for (const entry of Object.values(
					console.entries,
				)) {
					for (const dir of makeArray(
						getFiles(entry.files, console.config.devMode),
					)) {
						if (extname(dir)) continue; // 数组形态声明的是具体文件而非目录
						const root = resolve(String(dir));
						const candidate = resolve(root, base);
						if (
							candidate.startsWith(root + sep) &&
							existsSync(candidate)
						) {
							return sendAsset(candidate);
						}
					}
				}
			}

			// 带扩展名的资源请求未命中时如实 404：回退 index.html 会让浏览器把
			// HTML 当 JS / Worker 解析，报出更费解的语法错误
			if (extname(name)) return (ctx.status = 404);

			const template = await Bun.file(
				resolve(console.root, "index.html"),
			).text();
			ctx.type = "html";
			ctx.body = await transformHtml(console, template);
		},
	);
}
