<template>
  <template v-if="logs?.length">
    <h2 class="k-schema-header">
      运行日志
    </h2>
    <logs class="settings-logger" :logs="logs" max-height="216px"/>
  </template>
</template>

<script setup lang="ts">
/*
 * 插件详情页的「运行日志」插槽：
 * 从全量日志里截取本次启动后、与当前插件相关的记录（按来源 paths 过滤）。
 */
import { store } from "@koishi-ce/client";
import { computed, inject } from "vue";
import Logs from "./logs.vue";

// 由配置管理面板注入的「当前插件」信息
const current: any = inject("manager.settings.current");

// 倒序扫描日志：遇到 id 回绕（重启边界）即停，
// 其间只保留 meta.paths 包含当前插件路径的记录，最后恢复正序
const logs = computed(() => {
	if (!store.logs) return [];
	const results = [];
	let last = Infinity;
	for (let index = store.logs.length - 1; index > 0; --index) {
		if (store.logs[index].id >= last) break;
		last = store.logs[index].id;
		if (!store.logs[index].meta?.paths?.includes(current.value.path)) continue;
		results.unshift(store.logs[index]);
	}
	return results;
});
</script>

<style scoped lang="scss">

.settings-logger {
  border-radius: 8px;
  :deep(.logs) {
    padding: 0.5rem 0.5rem;
  }

  @media screen and (max-width: 768px) {
    border-radius: 0;
    margin: 0 calc(0px - var(--content-padding));
  }
}

</style>
