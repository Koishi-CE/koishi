<!-- 负载条形图：将一条负载率（[本进程占比, 整机占比]）拆分为三段色带，
     依次为"其它进程"（used，主色）、"本进程"（app，警示色）与"空闲"（free，底色）。
     占比过半的段内嵌 "进程 / 整机" 百分比说明；无过半段时较宽的段各自标注自身占比。 -->
<template>
  <div class="load-bar">
    <span class="title">{{ title }}</span>
    <span class="body">
      <span
        v-for="(type, index) in types"
        :key="type"
        :class="[type, 'bar']"
        :style="{ width: percentage(distribution[index]) }">
        <template v-if="index === maxIndex">{{ caption }}</template>
        <template v-else-if="maxIndex === -1 && distribution[index] >= 0.2">{{ percentage(distribution[index]) }}</template>
      </span>
    </span>
  </div>
</template>

<script lang="ts" setup>
import type { LoadRate } from "@koishi-ce/plugin-status";
import { computed } from "vue";

const props = defineProps<{ rate: LoadRate; title: string }>();

function percentage(value: number, digits = 1) {
	return +(value * 100).toFixed(digits) + "%";
}

const types = ["used", "app", "free"] as const;

// 三段色带的宽度占比：整机减本进程（其它进程）、本进程、剩余空闲
const distribution = computed(() => [
	props.rate[1] - props.rate[0],
	props.rate[0],
	1 - props.rate[1],
]);

// 第一个占比 >= 50% 的段下标（找不到为 -1），该段足够宽时内嵌完整说明文案
const maxIndex = computed(() => {
	return distribution.value.findIndex((value) => value >= 0.5);
});

// 内嵌文案："本进程占比 / 整机占比"
const caption = computed(() => {
	return `${percentage(props.rate[0], 1)} / ${percentage(props.rate[1], 1)}`;
});
</script>

<style lang="scss" scoped>

.load-bar {
  display: flex;
  align-items: center;
  user-select: none;
  font-size: 0.9em;
  margin: 0.5rem 0;

  .title {
    min-width: 3em;
  }

  .body {
    width: 10rem;
    height: 0.8rem;
    font-size: 10px;
    position: relative;
    display: inline;
    background-color: var(--k-c-divisor);
    border-radius: 1rem;
    overflow: hidden;
    transition: var(--color-transition);
    color: var(--fg1);
  }

  .bar {
    height: 100%;
    position: relative;
    float: left;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: pre;
  }

  .used {
    background-color: var(--primary);
    color: white;
    transition: color 0.3s ease, background-color 0.3s ease;
    &:hover {
      background-color: var(--primary-tint, var(--primary));
    }
  }

  .app {
    background-color: var(--k-color-warning);
    transition: color 0.3s ease, background-color 0.3s ease;
    &:hover {
      background-color: var(--k-color-warning-tint, var(--k-color-warning));
    }
  }
}

</style>