<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <el-dialog v-if="store.market?.registry" v-model="showManual" class="manual-panel" destroy-on-close>
    <template #header>高级：手动添加依赖</template>
    <k-comment type="warning">
      <p>提示：如果你想要安装插件，请前往<router-link to="/market">插件市场</router-link>页面。</p>
    </k-comment>
    <el-input :class="{ invalid }" v-model="name" @keydown.enter.stop.prevent="onEnter" placeholder="请输入名称"></el-input>
    <template v-if="remote">
      <p>最新版本：{{ remote['dist-tags']?.latest }}</p>
      <p>介绍：{{ remote.description }}</p>
    </template>
    <template #footer>
      <el-button @click="showManual = false">取消</el-button>
      <el-button type="primary" :disabled="invalid" @click="onEnter">确定</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { store, useConfig } from "@koishi-ce/client";
import type {
	Registry,
	SearchObject,
} from "@koishi-ce/registry";
import { useDebounceFn } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import { addManual, showManual } from "./utils";

// npm registry 的 /<pkg> 端点响应实际携带 dist-tags（最新版本指针），
// Registry 类型未建模此字段，这里借 SearchObject 上的既有声明补齐
type RegistryDoc = Registry &
	Pick<SearchObject, "dist-tags">;

const config = useConfig();
const invalid = computed(() => false);
const name = ref("");
const remote = ref<RegistryDoc>();

const fetchRemote = useDebounceFn(async (name2: string) => {
	try {
		const data = await addManual(name2);
		if (name2 === name.value) remote.value = data;
	} catch {}
}, 500);

watch(name, (name2) => {
	if (name2 !== remote.value?.name)
		remote.value = undefined;
	if (!name2) return (remote.value = undefined);
	fetchRemote(name2);
});

function onEnter() {
	if (!remote.value) return;
	const { name } = remote.value;
	// 无最新版本指针时无法确定要写入的版本，保持对话框开启
	const latest = remote.value["dist-tags"]?.latest;
	if (!latest) return;
	const override = config.value.market.override;
	if (!override) return;
	override[name] = latest;
	showManual.value = false;
}
</script>

<style lang="scss">

.manual-panel {
  .k-comment {
    margin-top: 0;
  }
}

</style>
