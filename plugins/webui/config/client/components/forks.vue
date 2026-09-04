<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-dialog
    :model-value="!!dialogFork"
    @update:model-value="dialogFork = null"
    class="dialog-config-fork"
    destroy-on-close>
    <template #header="{ titleId, titleClass }">
      <span :id="titleId" :class="titleClass">
        {{ dialogFork + (local?.workspace ? t('config.forks.workspace') : '') }}
      </span>
    </template>
    <table>
      <tr v-for="id in plugins.forks[shortname]" :key="id">
        <td class="text-left">
          <span class="status-light" :class="getStatus(plugins.paths[id])"></span>
          <span class="path">{{ getFullPath(plugins.paths[id]) }}</span>
        </td>
        <td class="text-right">
          <span class="actions">
            <span class="action" @click.stop="configure(id)"><k-icon name="arrow-right"></k-icon></span>
            <span class="action" @click.stop="removeItem(plugins.paths[id])"><k-icon name="delete"></k-icon></span>
          </span>
        </td>
      </tr>
    </table>
    <template #footer>
      <div class="left">
        <template v-if="plugins.forks[shortname]?.length">
          {{ t('config.forks.count', [plugins.forks[shortname]?.length]) }}
        </template>
        <template v-else>
          {{ t('config.forks.none') }}
        </template>
      </div>
      <div class="right">
        <el-button @click.stop="configure()">{{ t('config.forks.add') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * fork 管理弹窗：管理同一插件的多份配置（fork）。
 *
 * 表格逐行列出该插件的每份配置（状态灯 + 完整分组路径），
 * 提供跳转编辑、删除操作，底部支持新建一份配置。
 * 由全局状态 dialogFork 控制显隐（configWriter.ensure 与
 * "管理多份配置"菜单项都会打开它）。
 */
import { router, send, store } from "@koishi-ce/client";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
	dialogFork,
	getStatus,
	plugins,
	removeItem,
	type Tree,
} from "./utils";

const { t } = useI18n();

/** 弹窗对应的插件短名。 */
const shortname = computed(() =>
	dialogFork.value?.replace(
		/(koishi-|^@koishijs\/)plugin-/,
		"",
	),
);
const local = computed(
	() => store.packages?.[dialogFork.value],
);

/** 单个节点的显示文案：`标签 [路径]`。 */
function getLabel(tree: Tree) {
	return `${tree.label ? `${tree.label} ` : ""}[${tree.path}]`;
}

/** 从根到该节点的完整层级路径（用 " > " 连接，不含全局设置）。 */
function getFullPath(tree: Tree) {
	const path = [getLabel(tree)];
	while (tree.parent) {
		tree = tree.parent;
		path.unshift(getLabel(tree));
	}
	path.shift();
	return path.join(" > ");
}

/**
 * 跳转到某份配置的编辑页；不传 key 时先新建一份停用配置。
 *
 * @param key 现有配置的路径标识（留空则新建）
 */
async function configure(key?: string) {
	const target = shortname.value;
	if (!key) {
		key = Math.random().toString(36).slice(2, 8);
		void send("manager/unload", "", `${target}:${key}`, {});
	}
	await router.push(`/plugins/${key}`);
	dialogFork.value = null;
}
</script>

<style lang="scss">

.dialog-config-fork {
  .el-dialog__header .el-dialog__title {
    font-weight: 500;
    color: var(--fg1);
    margin-right: 0.5rem;
    flex: 0 0 auto;
  }

  .status-light {
    margin-right: 0.75rem;
  }

  .actions {
    display: flex;
    gap: 0 0.5rem;
    align-items: center;
    justify-content: flex-end;
  }

  .action {
    display: inline-flex;
    width: 1.25rem;
    justify-content: center;
    cursor: pointer;
    color: var(--fg2);
    transition: var(--color-transition);

    &:hover {
      color: var(--fg1);
    }
  }

  .el-dialog__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9em;
  }
}

</style>
