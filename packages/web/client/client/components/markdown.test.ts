// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 内置 Markdown 组件（`client/components/markdown.ts`）的行为回归测试。
 *
 * 该组件是 npm 包 `marked-vue@1.3.0` 的就地 vendor 版。本文件把它的对外
 * 可观测行为逐条钉死，使后续替换解析器（marked）与消毒器（xss）时能精确
 * 看出「哪一条变了」，而非只看产物大小。
 *
 * 测试文件不进入 tsconfig.web 类型检查（见其 exclude），运行时由 bun test
 * 覆盖。
 *
 * 已知的上游怪癖（此处按现状锁定，非本仓引入；均为惰性残留、无可利用面）
 *   - 白名单外标签的**开标签**被整体丢弃，但配对时栈里已压入该标签名，
 *     故其**闭标签**会原样留在输出里（`<script>` → 只剩 `</script>`）；
 *   - 标签名大小写不归一：`<B>` 的开标签被 xss 小写化，闭标签按原文透传。
 */
import { describe, expect, it } from "bun:test";
import KMarkdown, { sanitize } from "./markdown.ts";

// sanitize 判定链接协议时以 location 为基准解析相对 URL；bun 无 DOM，
// 故补一个最小桩（相对路径、`#锚点`、协议相对 URL 的判定都依赖它）
const scope = globalThis as unknown as {
	location?: unknown;
};
if (typeof scope.location === "undefined") {
	scope.location = new URL("https://console.example/");
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
	it("script 的开标签与内容被剥离", () => {
		// 注意：闭标签作为已知怪癖残留（见文件头注释）
		expect(sanitize("<script>alert(1)</script>")).toBe(
			"alert(1)</script>",
		);
		expect(sanitize("<iframe src=x></iframe>")).toBe(
			"</iframe>",
		);
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

	it("协议白名单外的 href 降级为 #", () => {
		const degraded =
			'<a href="#" rel="noopener noreferrer" target="_blank">x</a>';
		expect(
			sanitize('<a href="javascript:alert(1)">x</a>'),
		).toBe(degraded);
		expect(sanitize('<a href="ftp://a.com">x</a>')).toBe(
			degraded,
		);
	});

	it("白名单协议原样保留（http / https / mailto / tel）", () => {
		expect(sanitize('<a href="mailto:a@b.c">x</a>')).toBe(
			'<a href="mailto:a@b.c" rel="noopener noreferrer" target="_blank">x</a>',
		);
		expect(sanitize('<a href="tel:+1">x</a>')).toBe(
			'<a href="tel:+1" rel="noopener noreferrer" target="_blank">x</a>',
		);
	});

	it("相对路径 / 锚点 / 协议相对 URL 按当前页面解析后放行", () => {
		// 记录现状：协议相对 URL `//host` 会按 location 的协议解析，
		// 故被判为 https 而放行——这是「跟随当前页面协议」的既有语义
		for (const href of ["/rel", "#anchor", "//evil.com"]) {
			expect(sanitize(`<a href="${href}">r</a>`)).toBe(
				`<a href="${href}" rel="noopener noreferrer" target="_blank">r</a>`,
			);
		}
	});

	it("URL 解析会把协议归一化为小写，故大写协议同样放行", () => {
		expect(sanitize('<a href="HTTPS://A.com">x</a>')).toBe(
			'<a href="HTTPS://A.com" rel="noopener noreferrer" target="_blank">x</a>',
		);
	});

	it("title 保留并转义，其余属性一律丢弃", () => {
		expect(
			sanitize(
				'<a href="https://a.com" title="a&quot;b">x</a>',
			),
		).toBe(
			'<a href="https://a.com" title="a&quot;b" rel="noopener noreferrer" target="_blank">x</a>',
		);
		expect(sanitize('<a title="<script>">x</a>')).toBe(
			'<a title="&lt;script&gt;" rel="noopener noreferrer" target="_blank">x</a>',
		);
		expect(
			sanitize('<a data-x="1" href="https://a.com">x</a>'),
		).toBe(
			'<a href="https://a.com" rel="noopener noreferrer" target="_blank">x</a>',
		);
	});
});

describe("sanitize：栈式补闭合", () => {
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

	it("无配对开标签的闭标签转义为纯文本", () => {
		expect(sanitize("</b>")).toBe("&lt;/b&gt;");
	});

	it("标签名大小写不归一（开标签被小写化，闭标签透传）", () => {
		expect(sanitize("<B>x</B>")).toBe("<b>x</B>");
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

	it("unsafe 决定链接 href 是否被协议白名单改写", () => {
		const source = '<a href="javascript:x">j</a>';
		expect(html({ source, unsafe: true })).toBe(
			'<p><a href="javascript:x">j</a></p>\n',
		);
		expect(html({ source })).toBe(
			'<p><a href="#" rel="noopener noreferrer" target="_blank">j</a></p>\n',
		);
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

	it("script 经解析 + 消毒后的整体输出", () => {
		expect(html({ source: "<script>x</script>" })).toBe(
			"x</script>",
		);
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
