// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * monaco 编辑器集成：全局共享的编辑模型与 worker / 语言配置。
 *
 * - 创建整个文件管理器共享的单个 monaco 文本模型（model），切换文件
 *   只改 model 的值与语言，避免反复销毁重建编辑器实例
 * - 配置 MonacoEnvironment：只加载基础 editor worker，各语言的专用
 *   worker（TS / JSON / CSS / HTML）默认禁用（见下方注释掉的导入）
 * - 统一关闭 css / json / typescript / html 语言的重功能（补全、悬停、
 *   诊断等 web worker 语言服务），只保留基础着色，控制体积与开销；
 *   monaco 相关 chunk 的构建拆分见 build/client.ts 的 manualChunks
 */

import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { shallowRef } from "vue";

// 各语言专用 worker 的可选导入，默认全部禁用（统一退回基础 EditorWorker，
// 只做着色不开语言服务）；如需恢复某语言的智能提示，取消注释对应导入，
// 并在下方 getWorker 中按 label 分发
// import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
// import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
// import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
// import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'

declare global {
	interface Window {
		monaco: typeof monaco;
	}
}

// 挂到全局，便于其它模块（如控制台内嵌脚本）直接访问 monaco 命名空间
window.monaco = monaco;

window.MonacoEnvironment = {
	getWorker(_: string, _label: string) {
		// label 为 monaco 语言 id，如需启用语言服务，在此按 label 分发到
		// 上面注释掉的各专用 worker
		// if (label === 'typescript' || label === 'javascript') return new TsWorker()
		// if (label === 'json') return new JsonWorker()
		// if (label === 'css') return new CssWorker()
		// if (label === 'html') return new HtmlWorker()
		return new EditorWorker();
	},
};

/** 全局共享的编辑模型：所有文件共用一个 model，切换文件时 setValue 并切换语言。 */
export const model = monaco.editor.createModel("");

// monaco 0.56 起 languages.css / json / typescript / html 标记为
// { deprecated: true },语言配置入口迁移到顶层命名空间
// 以下四段对 css / less / scss、json、js / ts、html 系语言统一关闭
// 依赖 worker 的语言服务(补全/悬停/诊断/格式化等),只保留词法着色
const { cssDefaults, lessDefaults, scssDefaults } =
	monaco.css;
for (const service of [
	cssDefaults,
	lessDefaults,
	scssDefaults,
]) {
	service.setModeConfiguration({
		completionItems: false,
		hovers: false,
		documentSymbols: false,
		definitions: false,
		references: false,
		documentHighlights: false,
		rename: false,
		colors: false,
		foldingRanges: false,
		diagnostics: false,
		selectionRanges: false,
		documentFormattingEdits: false,
		documentRangeFormattingEdits: false,
	});
}

const { jsonDefaults } = monaco.json;
for (const service of [jsonDefaults]) {
	service.setModeConfiguration({
		documentFormattingEdits: false,
		documentRangeFormattingEdits: false,
		completionItems: false,
		hovers: false,
		documentSymbols: false,
		tokens: true,
		colors: false,
		foldingRanges: false,
		diagnostics: false,
		selectionRanges: false,
	});
}

const { javascriptDefaults, typescriptDefaults } =
	monaco.typescript;
for (const service of [
	javascriptDefaults,
	typescriptDefaults,
]) {
	service.setModeConfiguration({
		completionItems: false,
		hovers: false,
		documentSymbols: false,
		definitions: false,
		references: false,
		documentHighlights: false,
		rename: false,
		diagnostics: false,
		documentRangeFormattingEdits: false,
		signatureHelp: false,
		onTypeFormattingEdits: false,
		codeActions: false,
		inlayHints: false,
	});
}

const { htmlDefaults, handlebarDefaults, razorDefaults } =
	monaco.html;
for (const service of [
	htmlDefaults,
	handlebarDefaults,
	razorDefaults,
]) {
	service.setModeConfiguration({
		completionItems: false,
		hovers: false,
		documentSymbols: false,
		links: false,
		documentHighlights: false,
		rename: false,
		colors: false,
		foldingRanges: false,
		diagnostics: false,
		selectionRanges: false,
		documentFormattingEdits: false,
		documentRangeFormattingEdits: false,
	});
}

/** 当前 model 语言对应的 monaco 语言描述（status.vue 用它显示语言名）。 */
export const language = shallowRef(
	monaco.languages.getLanguages()[0],
);

// model 语言切换时同步 language 响应式引用，驱动状态栏更新
model.onDidChangeLanguage((e) => {
	language.value = monaco.languages
		.getLanguages()
		.find((x) => x.id === e.newLanguage);
});
