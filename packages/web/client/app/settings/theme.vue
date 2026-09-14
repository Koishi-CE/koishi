<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  主题选择器：role 为 "theme" 的字符串 schema 的专用渲染组件。
  下拉选项按明 / 暗模式过滤（主题 id 以 -light / -dark 结尾），
  每个选项以三色块 + 标题的形式预览主题配色。
-->
<template>
  <schema-base>
    <template #title><slot name="title"></slot></template>
    <template #desc><slot name="desc"></slot></template>
    <template #menu><slot name="menu"></slot></template>
    <template #prefix><slot name="prefix"></slot></template>
    <template #suffix><slot name="suffix"></slot></template>
    <template #control>
      <el-select popper-class="theme-select" v-model="model">
        <template v-for="(theme, key) in ctx.internal.themes" :key="key">
          <el-option :value="key" v-if="schema && key.endsWith('-' + schema.meta.extra.mode)">
            <div class="theme-root" :class="key.endsWith('-dark') ? 'dark' : 'light'" :theme="key">
              <div class="theme-block-1"></div>
              <div class="theme-block-2"></div>
              <div class="theme-block-3"></div>
              <div class="theme-title">
                {{ tt(theme.name) }}
              </div>
            </div>
          </el-option>
        </template>
      </el-select>
    </template>
  </schema-base>
</template>

<script setup lang="ts">
import { useContext, useI18nText } from "@koishi-ce/client";
import {
	type Schema,
	SchemaBase,
} from "@koishi-ce/components";
import { computed, type PropType, type Ref } from "vue";

defineProps({
	schema: {} as PropType<Schema>,
	modelValue: {} as PropType<unknown[]>,
	disabled: {} as PropType<boolean>,
	prefix: {} as PropType<string>,
	initial: {} as PropType<Record<never, never>>,
});

const emit = defineEmits(["update:modelValue"]);

const ctx = useContext();

const tt = useI18nText();

// SchemaBase 的运行时载体（schemastery-vue 的 form 对象）挂有 useModel
// 静态成员，但类型垫片未声明，此处原地断言补全（返回 ref 初始为 undefined，
// 供 themes 字典索引，类型标为 string 以配合 el-select 的 v-model）
const { useModel } = SchemaBase as typeof SchemaBase & {
	useModel: () => Ref<string>;
};

const config = useModel();

// el-select 的双向绑定：get 返回当前主题的显示名（供下拉框回显），
// set 把选中的主题 id（即 el-option 的 value）透传给父级表单
const model = computed({
	get() {
		const id = config.value;
		// 无当前主题时回退空串（el-select 的 v-model 不接受 undefined）
		if (id === undefined) return "";
		return tt(ctx.internal.themes[id]?.name) ?? "";
	},
	set(value) {
		emit("update:modelValue", value);
	},
});
</script>

<style lang="scss">

.el-select-dropdown.theme-select {
  overflow: hidden;

  .el-select-dropdown__list {
    margin: 0 !important;
  }

  .el-select-dropdown__item {
    padding: 0;
  }

  .theme-root {
    width: 100%;
    height: 100%;
    position: relative;

    .theme-block-1 {
      position: absolute;
      width: 33%;
      height: 100%;
      background-color: var(--bg1);
    }

    .theme-block-2 {
      position: absolute;
      left: 33%;
      width: 34%;
      height: 100%;
      background-color: var(--bg2);
    }

    .theme-block-3 {
      position: absolute;
      left: 67%;
      width: 33%;
      height: 100%;
      background-color: var(--bg3);
    }

    .theme-title {
      position: absolute;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      font-size: 1em;
      z-index: 100;
      font-family: var(--font-family);
      color: var(--k-color-primary);
    }
  }
}

</style>
