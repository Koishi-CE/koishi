// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Markdown 渲染组件（全局注册为 k-markdown）：marked 解析 + 消毒管线
 * （sanitize，见 core/markdown.ts，职责拆分的视图侧）。
 *
 * 来源：npm 包 `marked-vue@1.3.0`（MIT，shigma/marked-vue）就地 vendor
 * 后的视图层。解析器已换代：`marked` 9.1.6 → 18.0.14（2026-09-22，见
 * docs/decisions/dependency-audit.md §4.13）——输出差异经 72 条语料对拍，
 * 逐条核对后全部为上游解析修复。
 */
import { marked } from "marked";
import { defineComponent, h } from "vue";
import { sanitize } from "../core/markdown";

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
