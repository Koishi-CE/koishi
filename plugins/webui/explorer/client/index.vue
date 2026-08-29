<template>
  <k-layout menu="explorer">
    <template #header>
      资源管理器{{ active ? ' - ' + active : '' }}
    </template>

    <!-- 左侧栏：搜索框 + 可搜索/可重命名的文件树 -->
    <template #left>
      <el-scrollbar ref="root" @contextmenu.stop="trigger($event, rootEntry)">
        <div class="search">
          <el-input v-model="keyword">
            <template #suffix>
              <k-icon name="search"></k-icon>
            </template>
          </el-input>
        </div>
        <el-tree
          ref="tree"
          node-key="filename"
          :draggable="true"
          :data="data"
          :props="{ label: 'name', class: getClass }"
          :filter-node-method="filterNode"
          :allow-drag="allowDrag"
          :allow-drop="allowDrop"
          :default-expanded-keys="expandedKeys"
          @node-click="handleClick"
          @node-contextmenu="trigger"
          @node-expand="handleExpand"
          @node-collapse="handleCollapse"
          @node-drop="handleDrop"
          #="{ node }">
          <!-- 树节点内容：处于重命名态时渲染行内输入框，右侧 M 标记未保存的修改 -->
          <div class="item">
            <div class="label" :title="node.data.name">
              <input
                v-focus
                v-if="node.data.filename === renaming"
                v-model="node.data.name"
                @keypress.enter.prevent="confirmRename(node.data)"
                @keydown.escape.prevent="cancelRename()"
              />
              <template v-else>{{ node.data.name }}</template>
            </div>
            <div class="right">
              <template v-if="node.data.oldValue !== node.data.newValue">M</template>
            </div>
          </div>
        </el-tree>
      </el-scrollbar>
    </template>

    <!-- 主区域四态：未选文件 / 加载中 / 媒体预览（图片、音视频）/ monaco 编辑器 -->
    <k-empty v-if="!files[active] || files[active].type === 'directory'">在左侧栏选择要查看的文件</k-empty>
    <div v-else-if="files[active]?.loading">
      <div class="el-loading-spinner">
        <svg class="circular" viewBox="25 25 50 50">
          <circle class="path" cx="50" cy="50" r="20" fill="none"></circle>
        </svg>
        <p class="el-loading-text">正在加载……</p>
      </div>
    </div>
    <template v-else-if="files[active]?.mime">
      <k-image-viewer v-if="files[active].mime.startsWith('image/')" :src="files[active].newValue" />
      <audio v-else-if="files[active].mime.startsWith('audio/')" :src="files[active].newValue" controls />
      <video v-else-if="files[active].mime.startsWith('video/')" :src="files[active].newValue" controls />
      <div v-else>不支持的文件格式：{{ files[active].mime }}</div>
    </template>
    <div ref="editor" v-else class="editor"></div>
  </k-layout>

  <!-- 删除确认对话框：目录名的结尾补 / 以区分文件与文件夹 -->
  <el-dialog v-model="showRemoving" destroy-on-close>
    你真的要删除文件{{ removing?.endsWith('/') ? '夹' : '' }} {{ removing }} 吗？
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="removing = null">取消</el-button>
        <el-button type="primary" @click="send('explorer/remove', removing), removing = null">
          确认
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * 文件管理器主页面：左侧文件树 + 右侧内容区。
 *
 * 内容区按选中文件分四态展示（空态 / 加载中 / 媒体预览 / monaco 编辑器），
 * 文件的打开内容缓存在 Entry 的 oldValue/newValue 上，"M" 标记来自两者差异。
 * 这里同时注册页面动作（保存、刷新）与文件树右键菜单动作（新建、上传、
 * 下载、重命名、删除），并实现树内就地重命名（新建条目也复用该流程）。
 */
import {
	Binary,
	send,
	store,
	useColorMode,
	useContext,
	useMenu,
} from "@koishi-ce/client";
import type { Entry } from "@koishi-ce/plugin-explorer";
import { useElementSize } from "@vueuse/core";
import * as monaco from "monaco-editor";
import { computed, nextTick, onActivated, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { model } from "./editor";
import { files, type TreeEntry, uploading, vFocus } from "./store";

const ctx = useContext();
const route = useRoute();
const router = useRouter();
const keyword = ref(""); // 文件树过滤关键字
const tree = ref(null); // el-tree 实例（调用 filter() 做关键字过滤）
const root = ref<{ $el: HTMLElement }>(null); // 左侧滚动容器（滚动定位用）
const editor = ref(null); // monaco 编辑器的挂载容器
const renaming = ref<string>(null); // 正在重命名条目的路径，null 表示不在重命名态
const data = ref<TreeEntry[]>([]); // 本地文件树（含展开态，由服务端数据合并而来）
const removing = ref<string>(null); // 待删除条目的路径（结尾 / 表示目录），非空弹出确认框

const trigger = useMenu("explorer.tree");

// 保存(ctrl+s)：写回当前文件并消除 M 标记；
// disabled 保证无未保存修改或不在 files 页时不可触发
ctx.action("explorer.save", {
	shortcut: "ctrl+s",
	disabled: () =>
		files[active.value]?.newValue === files[active.value]?.oldValue ||
		!["files"].includes(router.currentRoute.value?.meta?.activity.id),
	action: async () => {
		const content = files[active.value].newValue;
		// biome-ignore lint/nursery/noFloatingPromises: 已在 async 回调中 await，nursery 规则对 .vue 内 send 调用的误报
		await send("explorer/write", active.value, content);
		files[active.value].oldValue = content;
	},
});

// 刷新(ctrl+r)：让服务端重新遍历目录并下发文件树
ctx.action("explorer.refresh", {
	shortcut: "ctrl+r",
	disabled: () =>
		!["files"].includes(router.currentRoute.value?.meta?.activity.id),
	action: () => send("explorer/refresh"),
});

// 以下为文件树右键菜单动作，explorer 上下文携带被操作的 TreeEntry

// 新建文件 / 新建文件夹：在目标目录下插入待命名条目（两者仅 type 不同）
ctx.action("explorer.tree.create-file", {
	disabled: ({ explorer }) => explorer.tree.type !== "directory",
	action: ({ explorer }) => createEntry(explorer.tree, "file"),
});

ctx.action("explorer.tree.create-directory", {
	disabled: ({ explorer }) => explorer.tree.type !== "directory",
	action: ({ explorer }) => createEntry(explorer.tree, "directory"),
});

// 上传：记录目标目录并弹出全局上传对话框（upload.vue 接管拖拽/粘贴）
ctx.action("explorer.tree.upload", {
	disabled: ({ explorer }) => explorer.tree.type !== "directory",
	action: ({ explorer }) => (uploading.value = `${explorer.tree.filename}/`),
});

// 下载：仅文件可下载
ctx.action("explorer.tree.download", {
	disabled: ({ explorer }) => explorer.tree.type === "directory",
	action: ({ explorer }) => downloadFile(explorer.tree.filename),
});

// 删除：先取消可能的重命名态，再弹确认框
ctx.action("explorer.tree.remove", {
	disabled: ({ explorer }) => !explorer.tree.filename,
	action: ({ explorer }) => initRemove(explorer.tree),
});

// 重命名：进入就地编辑态（树节点渲染输入框）
ctx.action("explorer.tree.rename", {
	disabled: ({ explorer }) => !explorer.tree.filename,
	action: ({ explorer }) => {
		cancelRename();
		renaming.value = explorer.tree.filename;
	},
});

const showRemoving = computed({
	get: () => !!removing.value,
	set: (v) => (removing.value = null),
});

/** 深度优先收集所有已展开节点的 filename。 */
function* getExpanded(tree: TreeEntry[]) {
	for (const item of tree) {
		if (item.expanded) yield item.filename;
		if (item.children) yield* getExpanded(item.children);
	}
}

// 由本地展开状态推导 default-expanded-keys，文件树数据刷新后不丢展开态
const expandedKeys = computed(() => [...getExpanded(data.value)]);

/**
 * 用服务端新树 head 合并本地树 base：
 * 按 type + name 匹配旧节点并保留 expanded 等本地状态（子树递归合并），
 * 服务端新增的节点原样进入，返回合并后的新数组。
 */
function merge(base: TreeEntry[], head: Entry[]) {
	return head?.map((entry) => {
		const old = base.find(
			(old) => old.type === entry.type && old.name === entry.name,
		);
		if (old) {
			return {
				...old,
				...entry,
				children: merge(old.children, entry.children),
			};
		} else {
			return entry;
		}
	});
}

// 服务端文件树更新时合并进本地树（展开态等 UI 状态得以保留）
watch(
	() => store.explorer,
	(value) => {
		data.value = merge(data.value, value) || [];
	},
	{ immediate: true },
);

let instance: monaco.editor.IStandaloneCodeEditor = null;

// 关键字变化即时过滤树节点
watch(keyword, (val) => {
	tree.value.filter(val);
});

const mode = useColorMode();

// 编辑器容器出现/消失时创建/销毁 monaco 实例（共享全局 model）
watch(editor, () => {
	if (!editor.value) return (instance = null);
	instance = monaco.editor.create(editor.value, {
		model,
		theme: `vs-${mode.value}`,
		tabSize: 2,
	});
});

const { width, height } = useElementSize(editor);

// 容器尺寸变化时让 monaco 重新布局
watch([width, height], () => {
	instance?.layout();
});

// 明暗主题切换
watch(mode, () => {
	monaco.editor.setTheme(`vs-${mode.value}`);
});

// 当前激活文件：取路由 /files/ 之后的路径段；不在 files 索引中则回退空串
const active = computed<string>({
	get() {
		const name = route.path.slice(6);
		return name in files ? name : "";
	},
	set(name) {
		if (!(name in files)) name = "";
		router.replace(`/files${name}`);
	},
});

/** 节点样式回调：给当前激活文件对应的树节点加 is-active 类。 */
function getClass(data: TreeEntry) {
	const words: string[] = [];
	if (data.name === active.value) words.push("is-active");
	return words.join(" ");
}

/** el-tree 过滤回调：节点名包含关键字即保留（大小写不敏感）。 */
function filterNode(value: string, data: TreeEntry) {
	return data.name.toLowerCase().includes(keyword.value.toLowerCase());
}

/**
 * 新建条目：在目标目录下插入一个待命名的占位条目并展开父目录，
 * 名字在 confirmRename 时才真正确认（与重命名共用同一流程）。
 */
function createEntry(entry: TreeEntry, type: "file" | "symlink" | "directory") {
	cancelRename();
	renaming.value = `${entry.filename}/`;
	files[renaming.value] = {
		type,
		name: "",
		filename: renaming.value,
		oldValue: "",
		newValue: "",
	};
	entry.expanded = true;
	entry.children.push(files[renaming.value]);
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
	const segments = entry.filename.split(/\//g);
	const name = segments.pop();
	segments.push(entry.name);
	const filename = segments.join("/");
	if (filename in files || !entry.name) {
		if (name) {
			entry.name = name;
		} else {
			delete files[entry.filename];
			const parent =
				files[segments.slice(0, -1).join("/")]?.children || data.value;
			parent.splice(parent.indexOf(entry), 1);
		}
	} else if (entry.filename !== filename) {
		files[filename] = entry;
		delete files[entry.filename];
		if (name) {
			void send("explorer/rename", entry.filename, filename);
			active.value = filename;
		} else if (entry.type === "file") {
			void send("explorer/write", filename, "");
			active.value = filename;
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
	const segments = entry.filename.split(/\//g);
	const name = segments.pop();
	segments.push(entry.name);
	if (name) {
		entry.name = name;
	} else {
		delete files[entry.filename];
		const parent =
			files[segments.slice(0, -1).join("/")]?.children || data.value;
		parent.splice(parent.indexOf(entry), 1);
	}
	renaming.value = null;
}

/** el-tree 内部节点结构（仅声明用到的字段）。 */
interface Node {
	label: string;
	data: TreeEntry;
	parent: Node;
	expanded: boolean;
	isLeaf: boolean;
	childNodes: Node[];
}

// 拖拽排序对应"移动文件"语义，暂未实现，故全量禁用（以下两函数恒返 false）
function allowDrag(node: Node) {
	return false;
}

function allowDrop(
	source: Node,
	target: Node,
	type: "inner" | "prev" | "next",
) {
	return false;
}

/** 按扩展名匹配 monaco 语言 id，无匹配时回退 plaintext。 */
function getLanguage(filename: string) {
	const index = filename.lastIndexOf(".");
	const extension = index === -1 ? "" : filename.slice(index);
	for (const language of monaco.languages.getLanguages()) {
		if (language.extensions?.includes(extension)) return language.id;
	}
	return "plaintext";
}

// 选中文件变化时按需加载内容：只有首次打开（oldValue 非字符串）才发
// read 请求；带 mime 的组装 data URL 走媒体预览，否则解码为文本进编辑器
watch(
	() => files[active.value],
	async (entry) => {
		if (!entry || entry.type === "directory") return;
		if (typeof entry.oldValue !== "string") {
			entry.loading = send("explorer/read", entry.filename);
			const { base64, mime } = await entry.loading;
			entry.loading = null;
			entry.mime = mime;
			if (mime) {
				entry.oldValue = entry.newValue = `data:${mime};base64,${base64}`;
			} else {
				entry.oldValue = entry.newValue = new TextDecoder().decode(
					Binary.fromBase64(base64),
				);
			}
		}
		model.setValue(entry.newValue);
		monaco.editor.setModelLanguage(model, getLanguage(entry.filename));
	},
	{ immediate: true },
);

// 编辑内容实时写回 entry.newValue（与 oldValue 的差异即为"M"未保存标记）
model.onDidChangeContent((e) => {
	const entry = files[active.value];
	if (!entry) return;
	entry.newValue = model.getValue();
});

/** 点击文件节点：设为当前激活文件（目录节点忽略）。 */
async function handleClick(data: TreeEntry) {
	if (data.type === "directory") return;
	active.value = data.filename;
}

// 虚拟根节点：包一层空名目录，让左侧空白区域右键也能触发新建/上传菜单
const rootEntry = computed<TreeEntry>(() => ({
	name: "",
	filename: "",
	type: "directory",
	children: data.value,
}));

/** 展开/折叠回调：把展开态记到节点上（供 expandedKeys 推导）。 */
function handleExpand(entry: TreeEntry) {
	entry.expanded = true;
}

function handleCollapse(entry: TreeEntry) {
	entry.expanded = false;
}

// 拖拽已被 allowDrag/allowDrop 全量禁用，留空实现仅为满足 el-tree 事件签名
function handleDrop(
	source: Node,
	target: Node,
	position: "before" | "after" | "inner",
	event: DragEvent,
) {}

/** 发起删除：先退出重命名态，目录路径补结尾 / 以示区分。 */
function initRemove(entry: TreeEntry) {
	cancelRename();
	removing.value = entry.filename + (entry.type === "directory" ? "/" : "");
}

// keep-alive 页面重新激活时，把当前选中节点滚动到可视区中央
onActivated(async () => {
	const container = root.value.$el;
	await nextTick();
	const element = container.querySelector(
		".el-tree-node.is-active",
	) as HTMLElement;
	if (!element) return;
	root.value["setScrollTop"](
		element.offsetTop - (container.offsetHeight - element.offsetHeight) / 2,
	);
});

/** 读取文件内容并触发浏览器下载（Blob + 临时 a 标签）。 */
async function downloadFile(filename: string) {
	const { base64 } = await send("explorer/read", filename);
	const blob = new Blob([Binary.fromBase64(base64)]);
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
</script>

<style lang="scss" scoped>

.editor {
  height: 100%;
  width: 100%;
  position: absolute;
}

.search {
  margin-top: 1rem;
  padding: 0 1.5rem;
}

.el-tree {
  margin-bottom: 1rem;
}

.item {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
}

.label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: var(--color-transition);
}

.right {
  height: 100%;
  margin: 0 0.75rem;
}

</style>
