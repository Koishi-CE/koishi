// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Markdown 渲染组件与消毒管线（`core/markdown.ts` + `display/markdown.ts`）
 * 的行为回归测试。
 *
 * 该组件是 npm 包 `marked-vue@1.3.0` 的就地 vendor 版。本文件把它的对外
 * 可观测行为逐条钉死，使后续替换解析器（marked）与消毒器时能精确看出
 * 「哪一条变了」，而非只看产物大小。
 *
 * 测试文件不进入 tsconfig.web 类型检查（见其 exclude），运行时由 bun test
 * 覆盖。
 *
 * 消毒层已由手写实现换成 DOMPurify（2026-09-22，见 dependency-audit.md
 * §4.13）。上游那两处手写偏差——白名单外标签的闭标签残留（`<script>` 只剩
 * `</script>`）、标签名大小写不归一（`<B>x</B>` → `<b>x</B>`）——随真实 DOM
 * 解析器的引入而消失，本文件对应用例如实反映新行为。
 */
import { describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import KMarkdown from "../display/markdown.ts";
import { sanitize } from "./markdown.ts";

// DOMPurify 是 DOM-only 库：它需要真实 DOM 才能工作。浏览器下由宿主提供
// window，测试下由这里的 jsdom 提供。组件内对消毒实例是惰性绑定，因此注入
// 不必抢在 import 之前，但必须在首次实际消毒之前。
const scope = globalThis as unknown as { window?: unknown };
if (typeof scope.window === "undefined") {
	scope.window = new JSDOM("").window;
}

/** 组件 props（与 markdown.ts 的声明一致）。 */
interface MarkdownProps {
	source?: string;
	inline?: boolean;
	tag?: string;
	unsafe?: boolean;
}

/** 渲染结果中本文件关心的部分。 */
interface Rendered {
	type?: unknown;
	props?: Record<string, unknown>;
}

/**
 * 直接取组件的渲染函数并执行：组件只读 props、不依赖组件实例，
 * 因此无需为测试引入 DOM 运行时（也不需要挂载）。
 */
function render(props: MarkdownProps): Rendered {
	const setup = KMarkdown.setup as unknown as (
		props: MarkdownProps,
	) => () => Rendered;
	return setup(props)();
}

/** 取渲染结果的 innerHTML。 */
function html(props: MarkdownProps): unknown {
	return render(props).props?.["innerHTML"];
}

describe("sanitize：白名单外标签被丢弃", () => {
	it("script / iframe 连标签带内容整体消失", () => {
		// 旧手写实现会把闭标签残留为孤立的 `</script>` / `</iframe>`
		// （见文件头注释）；换成真实 DOM 解析器后整体移除
		expect(sanitize("<script>alert(1)</script>")).toBe("");
		expect(sanitize("<iframe src=x></iframe>")).toBe("");
	});

	it("img 整体丢弃（白名单刻意不含 img）", () => {
		expect(sanitize("<img src=x onerror=alert(1)>")).toBe(
			"",
		);
	});

	it("事件处理器属性被剥离，标签本体保留", () => {
		expect(sanitize('<div onclick="steal()">t</div>')).toBe(
			"<div>t</div>",
		);
	});

	it("白名单内标签原样保留", () => {
		expect(sanitize("<p>plain</p>")).toBe("<p>plain</p>");
		expect(sanitize("<br>")).toBe("<br>");
	});
});

describe("sanitize：<a> 属性规范化", () => {
	it("保留 href，并补 rel / target 加固", () => {
		expect(sanitize('<a href="https://a.com">x</a>')).toBe(
			'<a href="https://a.com" rel="noopener noreferrer" target="_blank">x</a>',
		);
	});

	it("协议白名单外的 href 整体剔除（旧实现降级为 #）", () => {
		// 行为变更：旧手写实现把越界 href 篡改成 `#`（伪造一个无处可去的
		// 链接），DOMPurify 直接删掉该属性；无 href 即不再是链接，故
		// rel / target 也不再补
		for (const href of [
			"javascript:alert(1)",
			"ftp://a.com",
		]) {
			expect(sanitize(`<a href="${href}">x</a>`)).toBe(
				"<a>x</a>",
			);
		}
	});

	it("白名单协议原样保留（http / https / mailto / tel）", () => {
		expect(sanitize('<a href="mailto:a@b.c">x</a>')).toBe(
			'<a href="mailto:a@b.c" rel="noopener noreferrer" target="_blank">x</a>',
		);
		expect(sanitize('<a href="tel:+1">x</a>')).toBe(
			'<a href="tel:+1" rel="noopener noreferrer" target="_blank">x</a>',
		);
	});

	it("相对路径 / 锚点 / 协议相对 URL 一律放行", () => {
		// 协议相对 URL `//host` 跟随当前页面协议，属本组件一贯的既有
		// 语义（旧实现解析成 URL 后比对 protocol，同样放行）
		for (const href of ["/rel", "#anchor", "//evil.com"]) {
			expect(sanitize(`<a href="${href}">r</a>`)).toBe(
				`<a href="${href}" rel="noopener noreferrer" target="_blank">r</a>`,
			);
		}
	});

	it("URL 协议大小写不敏感", () => {
		expect(sanitize('<a href="HTTPS://A.com">x</a>')).toBe(
			'<a href="HTTPS://A.com" rel="noopener noreferrer" target="_blank">x</a>',
		);
	});

	it("title 保留，其余属性一律丢弃", () => {
		expect(
			sanitize(
				'<a href="https://a.com" title="a&quot;b">x</a>',
			),
		).toBe(
			'<a href="https://a.com" title="a&quot;b" rel="noopener noreferrer" target="_blank">x</a>',
		);
		// 属性值里的尖括号在 HTML 中无需转义（属性由引号界定，`<` 不会
		// 提前结束属性），故 DOMPurify 按规范原样保留；它仍是惰性文本，
		// 不会变成标签（下方 round-trip 用例钉死该结论）。
		// 本例同时钉死「无 href 的 <a> 不补 rel / target」——该 <a> 不是
		// 链接，加固无意义
		expect(sanitize('<a title="<script>">x</a>')).toBe(
			'<a title="<script>">x</a>',
		);
		expect(
			sanitize('<a data-x="1" href="https://a.com">x</a>'),
		).toBe(
			'<a href="https://a.com" rel="noopener noreferrer" target="_blank">x</a>',
		);
	});
});

describe("sanitize：结构补齐与规范化", () => {
	it("文末补齐未闭合标签", () => {
		expect(sanitize("<b>unclosed")).toBe("<b>unclosed</b>");
		expect(sanitize('<a href="https://a.com">')).toBe(
			'<a href="https://a.com" rel="noopener noreferrer" target="_blank"></a>',
		);
	});

	it("交叉嵌套按开标签顺序补齐", () => {
		expect(sanitize("<b><i>x</b>")).toBe("<b><i>x</i></b>");
		expect(sanitize("<div><span>x</div>")).toBe(
			"<div><span>x</span></div>",
		);
	});

	it("无配对开标签的闭标签直接丢弃（旧实现转义为纯文本）", () => {
		// 真实解析器把孤儿闭标签当文本忽略；旧手写实现会把它转义成
		// `&lt;/b&gt;` 显示出来
		expect(sanitize("</b>")).toBe("");
	});

	it("标签名统一归一为小写（旧实现闭标签透传原文）", () => {
		expect(sanitize("<B>x</B>")).toBe("<b>x</b>");
		expect(sanitize("<DIV><SPAN>y</SPAN></DIV>")).toBe(
			"<div><span>y</span></div>",
		);
	});
});

describe("k-markdown：props 语义", () => {
	it("默认按块级解析，包裹 div 且带 markdown class", () => {
		const vnode = render({ source: "**hi**" });
		expect(vnode.type).toBe("div");
		expect(vnode.props?.["class"]).toBe("markdown");
		expect(vnode.props?.["innerHTML"]).toBe(
			"<p><strong>hi</strong></p>\n",
		);
	});

	it("inline 走行内解析并默认包裹 span", () => {
		const vnode = render({
			source: "**hi**",
			inline: true,
		});
		expect(vnode.type).toBe("span");
		expect(vnode.props?.["innerHTML"]).toBe(
			"<strong>hi</strong>",
		);
	});

	it("tag 覆盖默认包裹标签（优先于 inline 的缺省）", () => {
		expect(
			render({ source: "hi", tag: "section" }).type,
		).toBe("section");
		expect(
			render({ source: "hi", inline: true, tag: "section" })
				.type,
		).toBe("section");
	});

	it("source 缺省或为空串时输出空内容，包裹标签不变", () => {
		expect(html({})).toBe("");
		expect(html({ source: "" })).toBe("");
		expect(render({})).toMatchObject({ type: "div" });
		expect(
			render({ source: "", inline: true }),
		).toMatchObject({
			type: "span",
		});
	});
});

describe("k-markdown：unsafe 开关", () => {
	it("unsafe 关闭消毒，开启时消毒", () => {
		const source = '<div onclick="steal()">t</div>';
		expect(html({ source, unsafe: true })).toBe(source);
		expect(html({ source })).toBe("<div>t</div>");
	});

	it("unsafe 决定非法链接是否被拦下", () => {
		const source = '<a href="javascript:x">j</a>';
		expect(html({ source, unsafe: true })).toBe(
			'<p><a href="javascript:x">j</a></p>\n',
		);
		// 非 unsafe：href 被整体剔除（旧实现降级为 `#`）
		expect(html({ source })).toBe("<p><a>j</a></p>\n");
	});

	it("图片仅在 unsafe 下渲染（白名单不含 img）", () => {
		const source = "![alt](https://a.com/i.png)";
		expect(html({ source })).toBe("<p></p>\n");
		expect(html({ source, unsafe: true })).toBe(
			'<p><img src="https://a.com/i.png" alt="alt"></p>\n',
		);
	});
});

describe("k-markdown：解析输出基线", () => {
	// 本组为解析器（marked 18.0.14）的输出快照。升级 marked 或换解析器时
	// 若这些值变化，需逐条确认是有意变更还是回归，不可顺手改期望值。
	it("块级结构", () => {
		expect(html({ source: "# T" })).toBe("<h1>T</h1>\n");
		expect(html({ source: "> quote" })).toBe(
			"<blockquote>\n<p>quote</p>\n</blockquote>\n",
		);
		expect(html({ source: "1. a\n2. b" })).toBe(
			"<ol>\n<li>a</li>\n<li>b</li>\n</ol>\n",
		);
		expect(html({ source: "```js\ncode\n```" })).toBe(
			"<pre><code>code\n</code></pre>\n",
		);
	});

	it("多段落：块级分行，行内不切分", () => {
		expect(html({ source: "a\n\nb" })).toBe(
			"<p>a</p>\n<p>b</p>\n",
		);
		expect(html({ source: "a\n\nb", inline: true })).toBe(
			"a\n\nb",
		);
	});

	it("GFM 表格默认开启", () => {
		expect(
			html({ source: "| a | b |\n| - | - |\n| 1 | 2 |" }),
		).toBe(
			"<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>\n",
		);
	});

	it("script 经解析 + 消毒后整体消失", () => {
		expect(html({ source: "<script>x</script>" })).toBe("");
	});
});

describe("消毒输出的二次解析安全性（round-trip）", () => {
	// 本组把「消毒后的字符串再交给 HTML 解析器」当作最终验收：只比对字符串
	// 不足以证明安全，需确认重构 DOM 后不产生新的可执行节点或属性。

	/** 把消毒结果重新解析为 DOM，返回 body 内的元素描述。 */
	function reparse(html: string) {
		const dom = new JSDOM(`<!doctype html><body>${html}`);
		const body = dom.window.document.body;
		const elements = [...body.querySelectorAll("*")].map(
			(node) => ({
				tag: node.tagName.toLowerCase(),
				attrs: [...node.attributes].map((a) => a.name),
			}),
		);
		return { text: body.textContent, elements };
	}

	it("属性值里的尖括号不会变成标签", () => {
		// `<a title="<script>">x</a>` 的输出里含字面的 `<script>`，但它位于
		// 引号界定的属性值内；二次解析后应仍只有 a 一个元素
		const html = sanitize('<a title="<script>">x</a>');
		const { text, elements } = reparse(html);
		expect(elements.map((e) => e.tag)).toEqual(["a"]);
		expect(text).toBe("x");
	});

	it("事件处理器与危险协议在二次解析后仍不存在", () => {
		for (const source of [
			"<img src=x onerror=alert(1)>",
			'<a href="javascript:alert(1)">x</a>',
			'<div onclick="steal()">t</div>',
			"<svg onload=alert(1)></svg>",
			"<style>*{x:expression(alert(1))}</style>",
			"<script>alert(1)</script>",
		]) {
			const { elements } = reparse(sanitize(source));
			for (const element of elements) {
				for (const attr of element.attrs) {
					expect(attr.startsWith("on")).toBe(false);
				}
				expect(
					[
						"script",
						"style",
						"img",
						"svg",
						"iframe",
					].includes(element.tag),
				).toBe(false);
			}
		}
	});
});

describe("解析输出基线：marked 9 → 18 的差异", () => {
	// 2026-09-22 解析器由 marked@9.1.6 升至 marked@18.0.14（见 NOTICE 与
	// docs/decisions/dependency-audit.md）。升级前以 72 条语料 × 块级/行内
	// 两模式对拍，共 16 处差异，逐条核对后确认全部属上游解析修复。本组把
	// 其中可观测且有结论的部分钉死，作为下一次升级的对照基线。
	// 涉及 <a> 的用例一律 unsafe: true，以隔离解析器（消毒层会重写 <a>）。

	it("自动链接的 href 里 & 被转义（9 透传裸 &）", () => {
		expect(
			html({
				source: "https://a.com/b?c=1&d=2",
				unsafe: true,
			}),
		).toBe(
			'<p><a href="https://a.com/b?c=1&amp;d=2">https://a.com/b?c=1&amp;d=2</a></p>\n',
		);
	});

	it("不再产出链接套链接（9 会给出非法嵌套 <a>）", () => {
		expect(
			html({ source: "[a [b](/y)](/x)", unsafe: true }),
		).toBe('<p>[a <a href="/y">b</a>](/x)</p>\n');
	});

	it("数字字符引用按 CommonMark 解码（9 原样保留）", () => {
		expect(html({ source: "&#65; &#x41;" })).toBe(
			"<p>A A</p>\n",
		);
	});

	it("块级修复：空列表项 / 空代码块 / 标题闭合序列", () => {
		// 列表项只有尾随空格时，9 认不出列表
		expect(html({ source: "- \n" })).toBe(
			"<ul>\n<li></li>\n</ul>\n",
		);
		// 空代码块不再多出一个换行
		expect(html({ source: "```\n```\n" })).toBe(
			"<pre><code></code></pre>\n",
		);
		// ATX 标题的闭合序列前允许制表符（9 会把它当正文留下）
		expect(html({ source: "# a\t#\n" })).toBe(
			"<h1>a</h1>\n",
		);
	});
});
