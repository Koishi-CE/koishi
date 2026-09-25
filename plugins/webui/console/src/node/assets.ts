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
 *
 * 本地安全加固（上游同步时勿回退，与上游逐字 diff 预期不一致）：
 * - 主体资源的 403 判定删除上游的 `includes('node_modules')` 弱放行——
 *   该条件允许路径先逃逸出 root 再以磁盘上任意 node_modules 目录为锚
 *   放行（如 /console/../../Other/node_modules/x），构成越界读文件面；
 *   本仓构建管线不产生指向 node_modules 的资源引用，无合法消费者；
 * - transformHtml 的 KOISHI_CONFIG 注入把 JSON 中的 `<` 转义为 `\u003c`，
 *   防止配置值中的 `</script>` 提前闭合标签注入任意 HTML；
 * - head 注入的 content 按标签语义分派转义（script/style 中和闭合序列、
 *   其余标签按实体转义），tag 名以正则白名单校验。
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
	// JSON.stringify 不转义 `<`：配置值（uiPath/selfUrl 等）中的
	// `</script>` 会提前闭合 script 标签注入任意 HTML。统一把 `<`
	// 转写为 `\u003c`——JSON 字符串语法等价，脚本解析语义不变
	let headInjection = `<script>KOISHI_CONFIG = ${JSON.stringify(console.createGlobal()).replace(/</g, "\\u003c")}</script>`;
	for (const { tag, attrs = {}, content } of head) {
		// tag 原样内插进产物 HTML，仅放行合法的 HTML 标签名，
		// 防止借 tag 夹带属性或第二个标签（如 img src=x onerror=...）
		if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag)) continue;
		const attrString = Object.entries(attrs)
			.map(
				([key, value]) =>
					` ${key}="${h.escape(value ?? "", true)}"`,
			)
			.join("");
		// content 的转义按标签语义分派：script/style 的内容是代码，
		// 实体转义会破坏功能，仅中和闭合序列（`<\/script` 在 JS 与 CSS
		// 的字符串/正则转义规则下与 `</script` 等价）防提前出标签；
		// 其余标签的内容是文本，按 HTML 实体转义
		const escaped =
			tag === "script"
				? (content ?? "").replace(
						/<\/script/gi,
						"<\\/script",
					)
				: tag === "style"
					? (content ?? "").replace(
							/<\/style/gi,
							"<\\/style",
						)
					: h.escape(content ?? "");
		headInjection += `<${tag}${attrString}>${escaped}</${tag}>`;
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
			// 防路径穿越：主体资源只允许位于 root 内。上游此处的
			// `!filename.includes('node_modules')` 分支是弱放行——路径先
			// 逃逸出 root 再以磁盘上任意 node_modules 目录为锚即可放行
			// （如 /console/../../Other/node_modules/x 直接读出盘上文件）；
			// 本仓产物不产生指向 node_modules 的资源引用，root 外一律 403
			if (
				filename !== console.root &&
				!filename.startsWith(console.root + sep)
			) {
				return (ctx.status = 403);
			}

			const stats = await fs
				.stat(filename)
				.catch<Stats>(noop);
			if (stats?.isFile()) return sendAsset(filename);

			// 控制台主体未命中时，再到各插件产物目录按文件名兜底：插件产物里的
			// 分包可能以根绝对路径引用（monaco 时代的 worker 即形如
			// /editor.worker-*.js），这类请求不带 @plugin- 前缀，会落到主体分支；
			// 产物文件名通常带内容哈希，按 basename 在各 entry 目录内探测
			// 不会产生跨插件混淆
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
