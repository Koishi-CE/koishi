// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * explorer 浏览器端的共享状态。
 *
 * 核心是 files：把服务端下发的树形 Entry[]（store.explorer）展平成
 * "完整路径 -> Entry" 的扁平索引，供文件树、路径选择器等组件按路径
 * O(1) 查找节点；数据更新时同步清理已不存在的旧键。
 */

import { type Dict, store } from "@koishi-ce/client";
import type { Entry } from "@koishi-ce/plugin-explorer";
import { type Directive, reactive, ref, watch } from "vue";

declare module "@koishi-ce/client" {
	interface ActionContext {
		"explorer.tree": TreeEntry;
	}
}

/** 文件树节点的客户端扩展：记录展开状态（el-tree 的 key 与过滤依赖它）。 */
export interface TreeEntry extends Entry {
	expanded?: boolean;
}

/** 全部条目的扁平索引：键为以 / 开头的完整相对路径，值为对应 Entry。 */
export const files = reactive<Dict<Entry>>({});

watch(
	() => store.explorer,
	() => {
		const oldFiles = { ...files };
		// store.explorer 与 entry.children 都可能为 undefined,
		// 函数体内已有空值短路,参数类型如实放宽
		function traverse(entries: Entry[] | undefined, prefix = "/") {
			if (!entries) return;
			for (const entry of entries) {
				entry.filename = prefix + entry.name;
				files[entry.filename] = entry;
				delete oldFiles[entry.filename];
				traverse(entry.children, `${entry.filename}/`);
			}
		}
		traverse(store.explorer);
		for (const filename in oldFiles) {
			delete files[filename];
		}
	},
	{ immediate: true },
);

/** v-focus 自定义指令：挂载后立即聚焦（供树内重命名输入框使用）。 */
export const vFocus: Directive = {
	mounted: (el) => el.focus(),
};

/** 正在上传的目标目录（以 / 结尾）；非 null 时显示上传对话框，null 表示关闭。 */
export const uploading = ref<string | null>(null);
