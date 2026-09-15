<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <!-- navigation -->
  <div class="navigation flex flex-wrap gap-x-4 gap-y-2 my-8" v-if="object">
    <a class="el-button" target="_blank"
      v-if="object.package.links?.['homepage']"
      :href="object.package.links['homepage']"
    >插件主页</a>
    <a class="el-button" target="_blank"
      v-if="object.package.links?.['npm'] && local?.package.version"
      :href="object.package.links['npm'] + '/v/' + local.package.version"
    >当前版本：{{ local.package.version }}</a>
    <a class="el-button" target="_blank"
      v-if="object.package.links?.['repository']"
      :href="object.package.links['repository']"
    >存储库</a>
    <a class="el-button" target="_blank"
      v-if="object.package.links?.['bugs']"
      :href="object.package.links['bugs']"
    >问题反馈</a>
  </div>

  <!-- latest -->
  <k-comment v-if="hasUpdate(name) && !global.static">
    <p>当前的插件版本不是最新，<router-link to="/dependencies">点击前往依赖管理</router-link>。</p>
  </k-comment>

  <!-- deprecated -->
  <k-comment v-if="dep?.resolved && versions?.[dep.resolved]?.deprecated" type="danger">
    <p>此版本已废弃，请尽快迁移：{{ versions[dep.resolved]?.deprecated }}</p>
  </k-comment>

  <!-- external -->
  <!-- TODO 人工复核：local 缺失（包不在本地列表）时点击会发送空版本（即卸载语义），
       原代码此处直接空引用崩溃，兜底值 "" 只是权宜，理想行为应是装最新版或隐藏按钮 -->
  <k-comment type="warning" v-if="!local?.workspace && store.dependencies && !store.dependencies[name]">
    <p>尚未将当前插件列入依赖，<span class="k-link" @click="send('market/install', { [name]: local?.package.version ?? '' })">点击添加</span>。</p>
  </k-comment>
</template>

<script lang="ts" setup>
import { global, send, store } from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-config";
import { type ComputedRef, computed, inject } from "vue";
import { hasUpdate } from "../utils";

// inject 失败时回退空名，各查询均落空、区块整体不渲染
const name =
	inject<ComputedRef<string>>("plugin:name") ??
	computed(() => "");

const local = computed(() => store.packages?.[name.value]);
const object = computed(
	() => store.market?.data?.[name.value],
);
const dep = computed(
	() => store.dependencies?.[name.value],
);
const versions = computed(
	() => store.registry?.[name.value],
);
</script>

<style lang="scss" scoped>

</style>
