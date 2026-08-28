import { type Dict, store } from "@koishi-ce/client";
import type { Entry } from "@koishi-ce/plugin-explorer";
import { type Directive, reactive, ref, watch } from "vue";

declare module "@koishi-ce/client" {
	interface ActionContext {
		"explorer.tree": TreeEntry;
	}
}

export interface TreeEntry extends Entry {
	expanded?: boolean;
}

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
				traverse(entry.children, entry.filename + "/");
			}
		}
		traverse(store.explorer);
		for (const filename in oldFiles) {
			delete files[filename];
		}
	},
	{ immediate: true },
);

export const vFocus: Directive = {
	mounted: (el) => el.focus(),
};

export const uploading = ref<string | null>(null);
