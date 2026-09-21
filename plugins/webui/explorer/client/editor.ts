// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 编辑器集成（CodeMirror 6）：文档、语言与主题。
 *
 * - 全文件管理器共用同一个 EditorView；切换文件时整体重建 EditorState
 *   （替换文档 + 清空撤销栈，与 monaco 时代 setValue 的语义一致），
 *   而不是反复销毁重建视图
 * - 语言由 languages.ts 按文件名解析后惰性加载，每个语言独立成 chunk
 * - 外观：外壳与颜色全部引用 editor.scss 定义的 --cm-* 变量（跟随控制台
 *   主题与 theme-vanilla 的主题覆写）；暗色模式的语法着色取 oneDark 的
 *   HighlightStyle，亮色模式用 CodeMirror 自带默认着色
 *
 * 与 monaco 时代的差异：不再向 window 挂全局命名空间（仓库内无消费者），
 * 也不再需要 worker——控制台侧为 monaco worker 做的根绝对路径兜底自此
 * 不再被触发（兜底逻辑本身保留，见 console/src/node/assets.ts）。
 */

import { indentWithTab } from "@codemirror/commands";
import {
	indentUnit,
	syntaxHighlighting,
} from "@codemirror/language";
import {
	Compartment,
	EditorState,
	type Extension,
} from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { shallowRef } from "vue";
import {
	PLAIN_TEXT,
	resolveLanguage,
} from "./languages.ts";

/** 当前语言的显示名（status.vue 的状态栏指示）。 */
export const language = shallowRef(PLAIN_TEXT);

/**
 * 编辑器外壳主题：颜色一律引用 editor.scss 的 --cm-* 变量。
 *
 * 用 CSS 变量而非固定色值，是为了让编辑器跟随控制台主题（含 theme-vanilla
 * 各主题的覆写）实时变化——monaco 时代靠覆写 --vscode-* 变量达成同一
 * 目的，这里换成自己的变量名，语义更直白。
 */
const shellTheme = EditorView.theme({
	"&": {
		height: "100%",
		fontSize: "14px",
		backgroundColor: "var(--cm-bg)",
		color: "var(--cm-fg)",
	},
	// 焦点态默认会加一圈 outline，在控制台里显得突兀
	"&.cm-focused": {
		outline: "none",
	},
	".cm-scroller": {
		fontFamily: "var(--font-family-code)",
		lineHeight: "1.6",
	},
	".cm-content": {
		caretColor: "var(--cm-caret)",
	},
	".cm-cursor, .cm-dropCursor": {
		borderLeftColor: "var(--cm-caret)",
	},
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground":
		{
			backgroundColor: "var(--cm-selection-bg)",
		},
	".cm-selectionMatch": {
		backgroundColor: "var(--cm-match-bg)",
	},
	".cm-activeLine": {
		backgroundColor: "var(--cm-active-line-bg)",
	},
	".cm-activeLineGutter": {
		backgroundColor: "var(--cm-active-line-bg)",
	},
	".cm-gutters": {
		backgroundColor: "var(--cm-gutter-bg)",
		color: "var(--cm-gutter-fg)",
		border: "none",
	},
	".cm-foldPlaceholder": {
		backgroundColor: "transparent",
		border: "none",
		color: "var(--cm-gutter-fg)",
	},
	".cm-tooltip": {
		backgroundColor: "var(--cm-tooltip-bg)",
		border: "1px solid var(--k-color-border)",
		color: "var(--cm-fg)",
	},
	".cm-tooltip-autocomplete ul li[aria-selected]": {
		backgroundColor: "var(--k-color-primary-fade)",
		color: "var(--cm-fg)",
	},
	".cm-panels": {
		backgroundColor: "var(--cm-gutter-bg)",
		color: "var(--cm-fg)",
	},
	".cm-searchMatch": {
		backgroundColor: "var(--cm-match-bg)",
	},
	".cm-searchMatch.cm-searchMatch-selected": {
		backgroundColor: "var(--cm-selection-bg)",
	},
});

/** 编辑器创建参数。 */
export interface EditorOptions {
	/** 挂载容器 */
	parent: HTMLElement;
	/** 初始是否为暗色（由控制台当前配色模式决定） */
	dark: boolean;
	/** 文档变更回调：把编辑器内容实时写回文件条目 */
	onChange(value: string): void;
}

/** 编辑器句柄：index.vue 借它驱动共享的 EditorView。 */
export interface EditorHandle {
	/** 整体替换文档内容（切换文件时调用，同时清空撤销栈） */
	setContent(value: string): void;
	/** 按文件名切换语法高亮（未支持时回退纯文本） */
	setLanguage(filename: string): Promise<void>;
	/** 切换明暗主题 */
	setTheme(dark: boolean): void;
	/** 销毁视图（容器卸载时调用） */
	destroy(): void;
}

/** 创建编辑器实例（实例自身即文档载体，不再有 monaco 那样的全局共享 model）。 */
export function createEditor(
	options: EditorOptions,
): EditorHandle {
	let dark = options.dark;
	/** 当前语言扩展（重建 state 时需要原样带回去） */
	let syntax: Extension = [];
	/** 语言加载令牌：异步加载期间若已切到别的文件，结果作废 */
	let token = "";
	/** 视图是否已销毁（异步回调返回时可能已晚，需自守） */
	let destroyed = false;

	const darkConf = new Compartment();
	const languageConf = new Compartment();

	/** 暗色语法着色的开关（亮色用 CodeMirror 自带默认着色）。 */
	const highlight = (): Extension =>
		dark ? syntaxHighlighting(oneDarkHighlightStyle) : [];

	const extensions = (): Extension => [
		basicSetup,
		// monaco 时代 Tab 为插入缩进，这里保持同一手感
		keymap.of([indentWithTab]),
		indentUnit.of("  "),
		EditorState.tabSize.of(2),
		shellTheme,
		darkConf.of(highlight()),
		languageConf.of(syntax),
		EditorView.updateListener.of((update) => {
			if (update.docChanged)
				options.onChange(update.state.doc.toString());
		}),
	];

	const view = new EditorView({
		parent: options.parent,
		state: EditorState.create({ extensions: extensions() }),
	});

	return {
		setContent(value) {
			// 重建 state 而非 dispatch 差异：撤销栈随之清空，切文件后
			// Ctrl+Z 不会把上一个文件的内容撤回来
			view.setState(
				EditorState.create({
					doc: value,
					extensions: extensions(),
				}),
			);
		},
		async setLanguage(filename) {
			const spec = resolveLanguage(filename);
			language.value = spec?.label ?? PLAIN_TEXT;
			token = filename;
			if (!spec) {
				syntax = [];
				if (!destroyed)
					view.dispatch({
						effects: languageConf.reconfigure([]),
					});
				return;
			}
			const extension = await spec.load();
			// 等待期间可能已切到别的文件（甚至容器已被卸载），此时丢弃以免语言串台
			if (destroyed || token !== filename) return;
			syntax = extension;
			view.dispatch({
				effects: languageConf.reconfigure(extension),
			});
		},
		setTheme(value) {
			dark = value;
			view.dispatch({
				effects: darkConf.reconfigure(highlight()),
			});
		},
		destroy() {
			// 先置销毁态：加载中的语言回调据此丢弃，不会 dispatch 到已销毁的视图
			destroyed = true;
			token = "";
			view.destroy();
		},
	};
}
