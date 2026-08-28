<template>
  <schema-base>
    <template #title><slot name="title"></slot></template>
    <template #desc><slot name="desc"></slot></template>
    <template #menu><slot name="menu"></slot></template>
    <template #prefix><slot name="prefix"></slot></template>
    <template #suffix><slot name="suffix"></slot></template>
    <template #control>
      <el-button @click="showDialog = true">{{ target ?? hint }}</el-button>
      <el-dialog class="file-picker" destroy-on-close v-model="showDialog">
        <template #header>
          <el-button class="back-button" :disabled="current === '/'" @click="toPrevious()">
            <k-icon name="chevron-left"></k-icon>
          </el-button>
          从 {{ current }} {{ hint }}
        </template>
        <el-scrollbar>
          <div class="entry" v-for="entry in entries" :key="entry.name" @click="handleClick(entry)">
            <k-icon class="entry-icon" :name="entry.type"></k-icon>
              <input
                v-focus
                v-if="entry.filename === current"
                v-model="entry.name"
                @keypress.enter.prevent="confirmRename()"
                @keydown.escape.prevent="cancelRename()"
              />
              <template v-else>{{ entry.name }}</template>
          </div>
        </el-scrollbar>
        <template #footer>
          <div class="left">
            <template v-if="options.allowCreate">
              <el-button v-if="allowFile" @click="uploading = current + '/'">上传文件</el-button>
              <el-button v-if="allowDir" @click="createFolder()">创建文件夹</el-button>
            </template>
          </div>
          <div class="right">
            <el-button @click="showDialog = false">取消</el-button>
            <el-button v-if="allowDir" type="primary" @click="confirm()">选定当前目录</el-button>
          </div>
        </template>
      </el-dialog>
    </template>
  </schema-base>
</template>

<script lang="ts" setup>
/**
 * 文件路径选择控件（Schema path 角色的渲染器）：
 * 在弹窗中浏览文件树并选择路径，支持按扩展名筛选、直接选定目录、
 * 新建文件夹与上传文件。选定的值写回表单的 modelValue。
 */
import {
	isNullable,
	type Schema,
	SchemaBase,
	send,
	store,
} from "@koishi-ce/client";
import {} from "@koishi-ce/koishi";
import type { Entry } from "@koishi-ce/plugin-explorer";
import { computed, type PropType, ref } from "vue";
import { files, uploading, vFocus } from "./store";

const props = defineProps({
	schema: {} as PropType<Schema>,
	modelValue: {} as PropType<string>,
	disabled: {} as PropType<boolean>,
	prefix: {} as PropType<string>,
	initial: {} as PropType<{}>,
});

const config = SchemaBase.useModel<string>();

defineEmits(["update:modelValue"]);

const options = computed<Schemastery.Path.Options>(() => ({
	// 合并 schema meta.extra 携带的 path 选项（filters 等），默认只允许选文件
	filters: ["file"],
	...props.schema.meta.extra,
}));

/** 是否允许选定目录（filters 含 "directory"）。 */
const allowDir = computed(() => options.value.filters.includes("directory"));
/** 是否允许选定文件（filters 中存在非 "directory" 的过滤项）。 */
const allowFile = computed(() =>
	options.value.filters.some((x) => x !== "directory"),
);

/** 按钮文案：根据可选类型给出提示。 */
const hint = computed(() => {
	if (!allowDir.value) {
		return "选择文件";
	} else if (allowFile.value) {
		return "选择目录或文件";
	} else {
		return "选择目录";
	}
});

const showDialog = ref(false);
const current = ref("/"); // 弹窗内当前浏览到的目录（始终以 / 结尾）

// 当前目录下的可见条目：目录恒显示，文件/符号链接按 filters 的扩展名过滤
const entries = computed(() => {
	const children =
		files[current.value.slice(0, -1)]?.children || store?.explorer || [];
	const { filters } = options.value;
	return children.filter((entry) => {
		if (entry.type === "directory") return true;
		if (entry.type === "file" || entry.type === "symlink") {
			const index = entry.name.lastIndexOf(".");
			const ext = index === -1 ? "" : entry.name.slice(index);
			return filters.some((filter) => {
				if (filter === "directory") return false;
				if (filter === "file") return true;
				if (typeof filter === "string") {
					return filter === ext;
				} else {
					return filter.extensions.includes(ext);
				}
			});
		}
	});
});

/** 点击条目：进入子目录，或选定文件（去掉开头的 / 写回表单值并关闭弹窗）。 */
function handleClick(entry: Entry) {
	if (entry.filename === current.value) return;
	if (entry.type === "directory") {
		current.value = current.value + entry.name + "/";
	} else {
		config.value = current.value.slice(1) + entry.name;
		showDialog.value = false;
	}
}

/** 新建文件夹：在当前目录插入一个待命名的空目录条目（回车确认）。 */
function createFolder() {
	files[current.value] = {
		type: "directory",
		name: "",
		filename: current.value,
		oldValue: "",
		newValue: "",
	};
	const parent =
		files[current.value.slice(0, -1)]?.children || store?.explorer || [];
	parent.push(files[current.value]);
}

/** 确认新建文件夹名：重名或空名视为取消；否则下发 mkdir 并更新索引。 */
function confirmRename() {
	const entry = files[current.value];
	if (!entry) return;
	const filename = current.value + entry.name;
	if (filename in files || !entry.name) {
		cancelRename();
	} else {
		files[filename] = entry;
		delete files[current.value];
		void send("explorer/mkdir", filename);
		entry.filename = filename;
	}
}

/** 取消新建：移除占位条目。 */
function cancelRename() {
	const entry = files[current.value];
	if (!entry) return;
	delete files[current.value];
	const parent =
		files[current.value.slice(0, -1)]?.children || store?.explorer || [];
	parent.splice(parent.indexOf(entry), 1);
}

/** 按钮上展示的已选路径：可识别时标注为文件/目录并显示名称。 */
const target = computed(() => {
	if (isNullable(config.value)) return;
	if (!config.value) return "根目录";
	const entry = files["/" + config.value];
	if (!entry) return config.value;
	return (entry.type === "file" ? "文件：" : "目录：") + entry.name;
});

/** 返回上一级目录。 */
function toPrevious() {
	const index = current.value.slice(0, -1).lastIndexOf("/");
	current.value = current.value.slice(0, index + 1);
}

/** "选定当前目录"：把当前目录（去掉首尾 /）写回表单值。 */
function confirm() {
	showDialog.value = false;
	if (allowDir.value) {
		config.value = current.value.slice(1, -1);
	}
}
</script>

<style lang="scss">

.file-picker {
  height: 50vh;
  display: flex;
  flex-direction: column;

  header {
    display: flex;
    align-items: center;
  }

  .back-button {
    width: 2rem;
    height: 2rem;
    margin-right: 0.75rem;
  }

  .el-dialog__body {
    flex: 1 1 auto;
    overflow: auto;
    padding: 20px 20px;
  }

  .entry {
    display: flex;
    align-items: center;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;

    &:hover {
      background-color: var(--k-hover-bg);
    }

    .entry-icon {
      height: 1rem;
      width: 1.25rem;
      margin-right: 0.5rem;
    }
  }

  .el-dialog__footer {
    display: flex;
    justify-content: space-between;

    .el-button + .el-button {
      margin-left: 1rem;
    }
  }
}

</style>
