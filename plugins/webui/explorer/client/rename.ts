// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 文件树的就地重命名流程（原 index.vue 拆出）。
 *
 * 新建条目复用同一流程：先插入待命名的占位条目（name 为空串），
 * 名字在 confirmRename 时才真正确认，并按原有名 / 新建文件 /
 * 新建目录三种情形下发对应 RPC。
 */
import { send } from "@koishi-ce/client";
import type { Ref, WritableComputedRef } from "vue";
import { ref } from "vue";
import { files, type TreeEntry } from "./store";

/** useRename 的组件侧依赖（文件树容器与当前激活文件）。 */
export interface RenameDeps {
	data: Ref<TreeEntry[]>;
	active: WritableComputedRef<string>;
}

export function useRename(deps: RenameDeps) {
	const renaming = ref<string | null>(null); // 正在重命名条目的路径，null 表示不在重命名态

	/**
	 * 结束编辑态的公共收尾：有原名则还原原名；无原名（新建的占位
	 * 条目）则从 files 索引与父级 children 中移除。
	 *
	 * @param entry 待处理的条目
	 * @param name 原名的最后一段（split 后 pop 得到；占位条目为 undefined）
	 * @param segments 原路径按 / 拆解、已替换末段为新名的段数组
	 * （父级路径取其 slice(0, -1)）
	 */
	function restoreOrRemove(
		entry: TreeEntry,
		name: string | undefined,
		segments: string[],
	) {
		if (name) {
			entry.name = name;
		} else {
			const key = entry.filename ?? "";
			delete files[key];
			const parent =
				files[segments.slice(0, -1).join("/")]?.children ||
				deps.data.value;
			parent.splice(parent.indexOf(entry), 1);
		}
	}

	/**
	 * 新建条目：在目标目录下插入一个待命名的占位条目并展开父目录，
	 * 名字在 confirmRename 时才真正确认（与重命名共用同一流程）。
	 */
	function createEntry(
		entry: TreeEntry,
		type: "file" | "symlink" | "directory",
	) {
		cancelRename();
		const filename = `${entry.filename}/`;
		renaming.value = filename;
		const placeholder: TreeEntry = {
			type,
			name: "",
			filename,
			oldValue: "",
			newValue: "",
		};
		files[filename] = placeholder;
		entry.expanded = true;
		entry.children?.push(placeholder);
	}

	/**
	 * 确认重命名 / 新建（输入框回车触发），分三种情形：
	 * 1. 目标路径已存在或名字为空 → 视为取消：有原名则还原，无原名
	 *    （新建的占位条目）则从父级 children 中移除；
	 * 2. 路径发生变化 → 更新 files 索引并按情况下发 rename（原有名）、
	 *    write 空内容（新建文件）或 mkdir（新建目录）；
	 * 3. 无变化 → 仅结束编辑态。
	 */
	function confirmRename(entry: TreeEntry) {
		const current = entry.filename ?? "";
		const segments = current.split(/\//g);
		const name = segments.pop();
		segments.push(entry.name);
		const filename = segments.join("/");
		if (filename in files || !entry.name) {
			restoreOrRemove(entry, name, segments);
		} else if (current !== filename) {
			files[filename] = entry;
			delete files[current];
			if (name) {
				void send("explorer/rename", current, filename);
				deps.active.value = filename;
			} else if (entry.type === "file") {
				void send("explorer/write", filename, "");
				deps.active.value = filename;
			} else {
				void send("explorer/mkdir", filename);
			}
			entry.filename = filename;
		}
		renaming.value = null;
	}

	/** 取消重命名：还原原名；新建的占位条目则直接从树中移除。 */
	function cancelRename() {
		if (!renaming.value) return;
		const entry = files[renaming.value];
		if (!entry) return;
		const segments = (entry.filename ?? "").split(/\//g);
		const name = segments.pop();
		segments.push(entry.name);
		restoreOrRemove(entry as TreeEntry, name, segments);
		renaming.value = null;
	}

	return {
		renaming,
		createEntry,
		confirmRename,
		cancelRename,
	};
}
