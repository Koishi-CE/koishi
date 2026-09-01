<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <k-layout class="page-locales">
    <template #header>
      本地化{{ active ? ' - ' + active : '' }}
    </template>

    <template #menu>
      <el-dropdown placement="bottom" popper-class="k-dropdown">
        <span class="menu-item">
          <k-icon class="menu-icon" name="globe"></k-icon>
        </span>
        <template #dropdown>
          <el-checkbox-group v-model="displayLocales">
            <template v-for="(_, locale) in store.locales" :key="locale">
              <el-checkbox v-if="locale && !locale.startsWith('$')" :label="locale">
                {{ locale }}
              </el-checkbox>
            </template>
          </el-checkbox-group>
        </template>
      </el-dropdown>
    </template>

    <template #left>
      <el-scrollbar>
        <div class="search">
          <el-input v-model="keyword">
            <template #suffix>
              <k-icon name="search"></k-icon>
            </template>
          </el-input>
        </div>
        <el-tree
          ref="tree"
          :data="data.data"
          :props="{ class: getClass }"
          :filter-node-method="filterNode"
          :default-expand-all="true"
          :expand-on-click-node="false"
          @node-click="handleClick"
        ></el-tree>
      </el-scrollbar>
    </template>

    <k-content v-if="active">
      <k-slot name="locale-main" :data="{ active }"></k-slot>

      <template v-for="path in data.map[active]" :key="path">
        <h3>{{ path }}</h3>
        <div class="grid my-4 translation gap-y-2">
          <template v-for="locale in displayLocales" :key="locale">
            <div class="lh-8 px-4">{{ locale }}</div>
            <div>
              <el-input
                autosize
                type="textarea"
                :modelValue="(store.locales['$' + locale]?.[`${active}.${path}`] as any)"
                :placeholder="store.locales[locale]?.[`${active}.${path}`] || store.locales[''][`${active}.${path}`] as any"
                @update:modelValue="handleUpdate(locale, path, $event)"
              ></el-input>
            </div>
          </template>
        </div>
      </template>
    </k-content>
    <k-empty v-else>
      <div>请在左侧选择类别</div>
    </k-empty>
  </k-layout>
</template>

<script lang="ts" setup>
/**
 * 本地化管理页面。
 *
 * 左侧为翻译键的分类树（按路径前缀聚合，支持关键字过滤），右侧对选中
 * 分类下的每个键展示各语言的翻译输入框（placeholder 显示原译文，编辑值
 * 写入 `$` 前缀的用户自定义命名空间），停止输入 1 秒后防抖统一提交回
 * node 侧（l10n 事件）落盘。顶部下拉可切换参与对照显示的语言。
 */
import { type Dict, send, store } from "@koishi-ce/client";
import { useDebounceFn } from "@vueuse/core";
import { computed, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const displayLocales = ref(["zh-CN", "en-US"]);
const tree = ref(null);
const keyword = ref("");

// 搜索关键字变化时过滤左侧分类树
watch(keyword, (val) => {
	tree.value.filter(val);
});

/** 当前选中的分类（点号分隔的键前缀），与路由路径双向同步。 */
const active = computed<string>({
	get() {
		const name = route.path.slice(9).replace(/\//g, ".");
		return name in data.value.map ? name : "";
	},
	set(name) {
		if (!(name in data.value.map)) name = "";
		router.replace(`/locales/${name.replace(/\./g, "/")}`);
	},
});

provide("locale:prefix", active);

/** 树节点过滤：label 包含关键字即命中（不区分大小写）。 */
function filterNode(value: string, data: Tree) {
	return data.label.toLowerCase().includes(keyword.value.toLowerCase());
}

/** 树节点的 class 计算：当前选中项附加 is-active。 */
function getClass(tree: Tree) {
	const words: string[] = [];
	if (tree.id === active.value) words.push("is-active");
	return words.join(" ");
}

/** 点击树节点切换选中分类。 */
function handleClick(tree: Tree) {
	active.value = tree.id;
}

/** 全部语言中出现过的翻译键（排除 `_` 开头的内部键与 `@` 特殊键）。 */
const paths = computed(() => {
	const result = {};
	for (const locale in store.locales) {
		Object.assign(result, store.locales[locale]);
	}
	return Object.keys(result).filter(
		(path) => !path.includes("._") && !path.includes("@"),
	);
});

/** 左侧分类树的节点形状。 */
interface Tree {
	id: string;
	label: string;
	children?: Tree[];
}

/** 递归按字母序排序树节点。 */
function sortTree(trees: Tree[]) {
	trees.sort((a, b) => a.label.localeCompare(b.label));
	for (const tree of trees) {
		if (tree.children) sortTree(tree.children);
	}
}

/**
 * 把扁平的翻译键路径组装成两层树：
 * 每个键按 `.` 拆分，取合适的前缀深度（默认 2 级；若某前缀自身存在
 * `前缀.$` 这样的子树键则提前截断），树节点为分类、map 记录每个分类下
 * 的剩余键后缀，供右侧面板逐键展示翻译框。
 */
const data = computed(() => {
	const data: Tree[] = [];
	const map: Dict<string[]> = {};
	for (const path of paths.value) {
		const parts = path.split(".");
		if (parts.length < 2 || path.includes("$")) continue;
		let children = data;
		let depth = Math.min(parts.length - 1, 2);
		for (let i = parts.length - 1; i >= depth; i--) {
			if (paths.value.includes(`${parts.slice(0, i).join(".")}.$`)) {
				depth = i;
				break;
			}
		}
		for (let i = 0; i < depth; i++) {
			const label = parts[i];
			const id = parts.slice(0, i + 1).join(".");
			let child = children.find((item) => item.id === id);
			if (!child) {
				child = { id, label };
				children.push(child);
				map[id] = [];
			}
			children = child.children ??= [];
		}
		map[parts.slice(0, depth).join(".")].push(parts.slice(depth).join("."));
	}
	sortTree(data);
	return { data, map };
});

/** 防抖提交：把 `$` 前缀的用户自定义翻译整体打包成 l10n 事件发给 node 侧。 */
const update = useDebounceFn(() => {
	const result = {};
	for (const locale in store.locales) {
		if (!locale.startsWith("$")) continue;
		result[locale.slice(1)] = store.locales[locale];
	}
	void send("l10n", result);
}, 1000);

/** 编辑某个键的某语言翻译：写入 `$<locale>` 命名空间（空值置 null 以删除），并触发防抖提交。 */
function handleUpdate(locale: string, path: string, value: string) {
	const root = (store.locales[`$${locale}`] ??= {});
	if (value) {
		root[`${active.value}.${path}`] = value;
	} else {
		root[`${active.value}.${path}`] = null;
	}
	update();
}
</script>

<style lang="scss">

.page-locales {
  .layout-left .el-scrollbar__view {
    padding: 1rem 0;
  }

  .search {
    padding: 0 1.5rem;
  }

  .translation {
    grid-template-columns: auto 1fr;
  }
}

.k-dropdown {
  .el-checkbox {
    display: flex;
    margin-right: 0;
    padding: 0 1rem;
  }
}

</style>
