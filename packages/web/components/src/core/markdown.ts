// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Markdown 消毒管线（DOMPurify 白名单 + 协议审查 + `<a>` 加固）。
 * 渲染视图（k-markdown 组件）见 display/markdown.ts，两者原是
 * marked-vue vendor 一体文件，按职责拆分至此。
 *
 * 来源：npm 包 `marked-vue@1.3.0`（MIT，shigma/marked-vue）的
 * `src/index.ts` 就地 vendor 进本仓。收回源码自持的理由是该包已停更
 * （最后一次提交为版本 bump，无 release），其依赖被钉死永不前进，而
 * 本仓需要能自主升级解析器与消毒器。
 *
 * 收回后消毒器已换代（见 docs/decisions/dependency-audit.md §4.14）：
 * 手写消毒层 → `dompurify` 3.4.15（2026-09-22）——上游原版是
 * 「白名单过滤 + 手写标签栈补闭合 + 手写 `<a>` 属性重建」，其中
 * 栈式补闭合与标签名归一都是自实现的近似（会留下游离闭标签、
 * 且标签名大小写不归一）。换成 DOMPurify 后这些工作交给真实 DOM
 * 解析器，两处偏差随之消失；白名单与加固语义保持等价。
 *
 * 安全边界（勿简化）：非 unsafe 模式下游走 sanitize()——标签白名单
 * + 属性收敛（仅 `<a>` 保留 href / title）+ 协议白名单（http / https /
 * mailto / tel，越界一律剔除）+ `<a>` 的 rel / target 加固。白名单刻意
 * 不含 img：非 unsafe 模式下的渲染对象包含第三方插件描述（市场列表、
 * 配置页的插件选择），放行 img 等于允许其借图片请求静默外发访问者信息。
 */
import DOMPurify from "dompurify";

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

/** 链接协议白名单（单一事实来源，供下方 URI 正则构造使用）。 */
const allowedProtocols = ["http", "https", "mailto", "tel"];

/**
 * DOMPurify 允许的链接（href）形态，与 allowedProtocols 等价：
 *   - 白名单协议，大小写不敏感（`HTTPS://A.com` 同样放行）；
 *   - 以非字母开头者——相对路径 `/x`、锚点 `#x`、协议相对 `//host`
 *     （后者跟随当前页面协议，是本组件一直以来的既有语义）；
 *   - 不含冒号的无协议串（`foo`），浏览器按相对路径处理。
 * 其余（`javascript:` / `data:` / `ftp:` / `blob:` 等）一律剔除。
 *
 * 与旧实现（解析成 URL 再比对 protocol）相比，各类混淆写法——实体
 * （`jAva&#115;cript:`）、裸控制字符（`java&#13;script:`、`java\0script:`）
 * ——会在 DOM 解析阶段先被解码归一，再落到本正则判定，因此同样被拒。
 */
const allowedUri = new RegExp(
	`^(?:(?:${allowedProtocols.join("|")}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`,
	"i",
);

/**
 * 消毒配置：标签白名单 + 仅 href / title 两个属性候选 + 链接协议白名单。
 *
 * ALLOW_DATA_ATTR / ALLOW_ARIA_ATTR 必须显式关掉：DOMPurify 对 `data-*`
 * 与 `aria-*` 默认「一律放行」，会绕过 ALLOWED_ATTR 的收敛，使第三方插件
 * 描述能塞进任意自定义属性。本组件的白名单语义是「每个标签零属性、仅
 * `<a>` 的 href / title 例外」，故一并关闭。
 */
const config = {
	ALLOWED_TAGS: allowedTags,
	ALLOWED_ATTR: ["href", "title"],
	ALLOWED_URI_REGEXP: allowedUri,
	ALLOW_DATA_ATTR: false,
	ALLOW_ARIA_ATTR: false,
};

/**
 * 属性收敛与 `<a>` 加固（afterSanitizeAttributes 钩子）。
 *
 * ALLOWED_ATTR 无法按标签限定，故这里把 href / title 收敛回 `<a>` 专有
 * （与旧白名单「每个标签零属性、仅 a 例外」的语义一致）。rel / target 只
 * 对真正的链接有意义，因此仅在 href 存活时补——非法协议的 href 会被
 * DOMPurify 整体剔除，此时该 `<a>` 已不是链接，不必再加固。
 *
 * 本钩子只删属性、只写固定字面量，不引入任何被消毒值，因此放在
 * afterSanitize* 阶段是安全的（该阶段的写入不再参与校验，也无需参与）。
 */
function hardenAttributes(node: Element) {
	if (node.tagName.toLowerCase() !== "a") {
		node.removeAttribute("href");
		node.removeAttribute("title");
		return;
	}
	if (!node.hasAttribute("href")) return;
	node.setAttribute("rel", "noopener noreferrer");
	node.setAttribute("target", "_blank");
}

/** 已绑定的消毒实例，以及它当初绑定的 DOM 视图。 */
type Purifier = ReturnType<typeof DOMPurify>;
let purifier: Purifier | undefined;
let purifierView: unknown;

/**
 * 取得绑定到当前 DOM 的消毒实例（首次调用时创建并挂上钩子）。
 *
 * 惰性初始化而非模块顶层创建：模块顶层求值发生在导入阶段，而宿主打包器
 * 与测试环境就绪 window 的时机各不相同，顶层取 window 会在无 DOM 的环境
 * （如 bun test）下拿到 undefined。DOMPurify 的默认导出本身是可调用的工
 * 厂（源码首行即 `(root) => createDOMPurify(root)`），因此即使它是在无
 * window 时求值的，此处传入 window 仍能得到功能完整的实例。
 */
function getPurifier(): Purifier {
	// client 工程（tsconfig.web.json）带 DOM lib，globalThis.window 在类型上
	// 即为 Window | undefined（无 DOM 的运行时取到 undefined），无需断言
	const view = globalThis.window;
	if (!view) {
		throw new Error(
			"k-markdown 的消毒层需要 DOM 才能工作：浏览器下由宿主提供，" +
				"测试下须在首次调用 sanitize() 之前注入 globalThis.window",
		);
	}
	if (!purifier || purifierView !== view) {
		purifierView = view;
		purifier = DOMPurify(view);
		purifier.addHook(
			"afterSanitizeAttributes",
			hardenAttributes,
		);
	}
	return purifier;
}

/** 消毒 HTML：标签白名单 + 属性收敛 + 链接协议白名单 + `<a>` 加固。 */
export function sanitize(html: string): string {
	return getPurifier().sanitize(html, config);
}
