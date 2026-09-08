<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  市场搜索框（本地化 fork 自 @koishijs/market 4.2.10 的
  client/components/search.vue）。
-->

<template>
  <div class="search-box">
    <div class="search-container">
      <span
        v-for="(word, index) in modelValue.slice(0, -1)"
        :key="index" class="search-word"
        :class="{ invalid: !validateWord(word) }"
        @click="onClickWord(index)"
      >{{ word }}</span>
      <input
        :placeholder="t('search.placeholder')"
        v-model="lastWord"
        ref="input"
        @blur="onEnter"
        @keydown.escape="onEscape"
        @keydown.backspace="onBackspace"
        @keypress.enter.prevent="onEnter"
        @keypress.space.prevent="onEnter" />
    </div>
    <div class="search-action" @click.stop="onClear">
      <market-icon class="search" name="search"></market-icon>
      <market-icon class="close" name="close"></market-icon>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
	MarketIcon,
	useMarketI18n,
	validateWord,
} from "@koishijs/market";
import { useDebounceFn } from "@vueuse/core";
import { computed, ref, watch } from "vue";

const props = defineProps<{
	modelValue: string[];
	placeholder?: string;
}>();

const emit = defineEmits(["update:modelValue"]);

const input = ref<HTMLInputElement>();
const words = ref<string[]>();

watch(
	() => props.modelValue,
	(value) => {
		words.value = value.slice();
	},
	{ immediate: true, deep: true },
);

const update = useDebounceFn(() => {
	emit("update:modelValue", words.value);
}, 100);

const lastWord = computed({
	get: () => words.value[words.value.length - 1],
	set: (value) => {
		words.value[words.value.length - 1] =
			value.toLowerCase();
		update();
	},
});

function onClickWord(index: number) {
	words.value.splice(index, 1);
	emit("update:modelValue", words.value);
	input.value?.focus();
}

function onEnter() {
	const last = words.value[words.value.length - 1];
	if (!last) return;
	if (words.value.slice(0, -1).includes(last)) {
		words.value.pop();
	}
	words.value.push("");
	emit("update:modelValue", words.value);
}

function onEscape(event: KeyboardEvent) {
	words.value[words.value.length - 1] = "";
	emit("update:modelValue", words.value);
}

function onBackspace(event: KeyboardEvent) {
	if (
		words.value[words.value.length - 1] === "" &&
		words.value.length > 1
	) {
		event.preventDefault();
		words.value.splice(words.value.length - 2, 1);
		emit("update:modelValue", words.value);
	}
}

function onClear() {
	words.value = [""];
	emit("update:modelValue", words.value);
}

const { t } = useMarketI18n();
</script>

<style lang="scss" scoped>

.search-box {
  display: flex;
  margin: 2rem auto 0;
  width: 100%;
  max-width: 640px;
  border-radius: 2rem;
  border: 1.5px solid var(--k-color-border);
  box-sizing: border-box;
  align-items: center;
  background-color: var(--k-card-bg);
  box-shadow: 0 2px 12px rgb(0 0 0 / 6%), 0 1px 3px rgb(0 0 0 / 4%);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;

  &:focus-within {
    border-color: var(--k-color-primary);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--k-color-primary) 15%, transparent),
      0 2px 12px rgb(0 0 0 / 6%),
      0 1px 3px rgb(0 0 0 / 4%);
  }
}

.search-container {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 6px;
  padding: 0.75rem 1.25rem;
  padding-right: 0;

  input {
    flex: 1 1 auto;
    height: 1.25rem;
    min-width: 10rem;
    font-size: 0.925rem;
    padding: 0;
    box-sizing: border-box;
    color: inherit;
    background-color: transparent;
    border: none;
    outline: none;
  }
}

.search-action {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 2.5rem;
  cursor: pointer;

  .market-icon {
    height: 1rem;
    opacity: 0.45;
    transition: opacity 0.2s ease;
  }

  &:hover .market-icon {
    opacity: 0.85;
  }

  &:hover .market-icon.search {
    display: none;
  }

  &:not(:hover) .market-icon.close {
    display: none;
  }
}

// 查询词 chip：主色调胶囊
.search-word {
  flex: 0 0 auto;
  display: inline-block;
  height: 1.375rem;
  line-height: calc(1.375rem - 2px);
  border-radius: 6px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--k-color-primary) 25%, transparent);
  background-color: color-mix(in srgb, var(--k-color-primary) 12%, transparent);
  color: var(--k-color-primary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  vertical-align: baseline;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease;

  &.invalid {
    opacity: 0.5;
    text-decoration: line-through;
  }

  &.invalid:hover {
    opacity: 1;
  }
}

@media (max-width: 420px) {
  .search-box {
    border-radius: 12px;
  }
}

</style>
