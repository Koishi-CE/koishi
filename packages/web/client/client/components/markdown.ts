// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置 Markdown 渲染组件（全局注册为 k-markdown）。
 *
 * 来源：npm 包 `marked-vue@1.3.0`（MIT，shigma/marked-vue）的
 * `src/index.ts` 就地 vendor 进本仓。收回源码自持的理由是该包已停更
 * （最后一次提交为版本 bump，无 release），其 marked 依赖被钉在
 * `^9.1.6` 永不前进，而本仓需要能自主升级解析器与消毒器。
 *
 * 行为与上游逐字等价，仅两处非行为改动：
 *   1. 上游的 `attrs: any` 改为 `Record<string, string>`（本仓显式 any
 *      为 0，且该类型与真实取值一致）；
 *   2. 遮蔽外层 `html` 的局部变量改名 `anchor`，并补齐中文注释。
 *
 * 收回源码自持后解析器随之升级到 marked@18（原 marked-vue 钉在 9.x）。
 * 升级核对了 72 条语料 × 块级/行内两模式的输出差异，全部为上游解析
 * 修复（含 HTML 属性转义、禁止链接套链接、CommonMark 字符引用解码等），
 * 消毒层的前提未变。
 *
 * 安全边界（勿简化）：非 unsafe 模式下游走 sanitize()——白名单标签
 * 过滤 + 未白名单标签整体丢弃 + `<a>` 属性规范化（协议白名单、标题
 * 转义、rel/target 加固）+ 栈式补闭合。白名单刻意不含 img（非 unsafe
 * 模式下图片被整体丢弃）。
 */
import { marked } from "marked";
import { defineComponent, h } from "vue";
import * as xss from "xss";

/**
 * 允许的标签白名单：取自 MDN 元素分类中较温和的几类
 * （内容分区 / 文本内容 / 行内语义 / 表格）。
 * 刻意不含 img —— 非 unsafe 模式下图片被整体丢弃。
 */
const allowedTags = [
	// 内容分区
	"address",
	"article",
	"aside",
	"footer",
	"header",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hgroup",
	"main",
	"nav",
	"section",
	// 文本内容
	"blockquote",
	"dd",
	"div",
	"dl",
	"dt",
	"figcaption",
	"figure",
	"hr",
	"li",
	"main",
	"ol",
	"p",
	"pre",
	"ul",
	// 行内文本语义
	"a",
	"abbr",
	"b",
	"bdi",
	"bdo",
	"br",
	"cite",
	"code",
	"data",
	"dfn",
	"em",
	"i",
	"kbd",
	"mark",
	"q",
	"rb",
	"rp",
	"rt",
	"rtc",
	"ruby",
	"s",
	"samp",
	"small",
	"span",
	"strong",
	"sub",
	"sup",
	"time",
	"u",
	"var",
	"wbr",
	// 表格
	"caption",
	"col",
	"colgroup",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
];

/**
 * 空元素：不发栈配对。img 虽不在白名单内（会被丢弃），
 * 仍列在此处以与上游行为保持一致。
 */
const voidTags = [
	"img",
	"br",
	"hr",
	"area",
	"base",
	"basefont",
	"input",
	"link",
	"meta",
];

/** 链接协议白名单：越界一律降级为 `#`。 */
const allowedProtocols = [
	"http:",
	"https:",
	"mailto:",
	"tel:",
];

/** 链接值是否落在协议白名单内（相对 URL 按当前页面地址解析）。 */
function checkUrl(value: string) {
	try {
		const url = new URL(value, location.toString());
		return allowedProtocols.includes(url.protocol);
	} catch {
		return false;
	}
}

/**
 * 消毒 HTML：白名单过滤 + `<a>` 属性规范化 + 栈式补闭合。
 *
 * onTag 返回值语义（xss 约定）：返回字符串即替换该标签的原始文本，
 * 返回 undefined 即交回 xss 的默认处理（白名单内原样、白名单外按
 * stripIgnoreTag 丢弃）。
 */
export function sanitize(html: string): string {
	const whiteList: xss.IWhiteList = Object.fromEntries(
		// 显式标注元组返回类型，否则 Object.fromEntries 推不出 [key, value]
		allowedTags.map((tag): [string, string[]] => [tag, []]),
	);
	const stack: string[] = [];
	html = xss.filterXSS(html, {
		whiteList,
		stripIgnoreTag: true,
		onTag(tag, raw, options) {
			// 起始 <a> 标签重建：只保留 href / title，其余属性一律丢弃
			let anchor: string | undefined;
			if (tag === "a" && !options.isClosing) {
				const attrs: Record<string, string> = {};
				xss.parseAttr(raw.slice(3), (name, value) => {
					if (name === "href") {
						attrs[name] = checkUrl(value) ? value : "#";
					} else if (name === "title") {
						attrs[name] = xss.escapeAttrValue(value);
					}
					return "";
				});
				attrs["rel"] = "noopener noreferrer";
				attrs["target"] = "_blank";
				anchor = `<a ${Object.entries(attrs)
					.map(([name, value]) => `${name}="${value}"`)
					.join(" ")}>`;
			}
			// 自闭合形态与空元素不发栈
			if (raw.endsWith("/>") || voidTags.includes(tag))
				return;
			if (!options.isClosing) {
				stack.push(tag);
				return anchor;
			}
			// 闭合标签：向上弹出未配对的栈，顺带补齐中间缺的闭合标签
			let result = "";
			while (stack.length) {
				const last = stack.pop();
				if (last === tag) return result + raw;
				result += `</${last}>`;
			}
			// 找不到配对的开标签：转义尖括号，按纯文本输出
			return raw
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		},
	});
	// 源码自身未闭合的标签，在文末补齐
	while (stack.length) {
		const last = stack.pop();
		html += `</${last}>`;
	}
	return html;
}

/** Markdown 渲染组件（k-markdown）。 */
const KMarkdown = defineComponent({
	props: {
		/** Markdown 源码 */
		source: String,
		/** 行内模式：走行内解析，且默认包裹 span 而非 div */
		inline: Boolean,
		/** 自定义包裹标签（缺省为 inline ? "span" : "div"） */
		tag: String,
		/** 跳过消毒（仅供可信来源，如插件自带的 usage 文档） */
		unsafe: Boolean,
	},
	setup(props) {
		return () => {
			// marked 的 parse / parseInline 均声明为「同步 | 异步」重载，
			// 异步形态只在 options.async 为 true 时出现，本组件是同步渲染，
			// 故统一按同步结果取用（与上游 marked-vue 的处理一致）
			const html = (
				props.inline
					? marked.parseInline(props.source || "")
					: marked.parse(props.source || "")
			) as string;
			return h(
				props.tag || (props.inline ? "span" : "div"),
				{
					class: "markdown",
					innerHTML: props.unsafe ? html : sanitize(html),
				},
			);
		};
	},
});

export default KMarkdown;
