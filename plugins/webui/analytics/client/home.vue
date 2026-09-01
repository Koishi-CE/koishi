<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!-- 控制台首页的统计面板：上半部分为数值卡网格（用户 / 群组 / DAU），
     下半部分为 analytic-chart 插槽位承载的各图表卡片，样式按视口宽度分档适配。 -->
<template>
  <number-grid></number-grid>
  <div class="card-grid chart-grid"><k-slot name="analytic-chart"></k-slot></div>
</template>

<script lang="ts" setup>
import NumberGrid from "./numbers/index.vue";
</script>

<style lang="scss">

.card-grid {
  display: grid;
  margin: var(--card-margin);
  grid-gap: var(--card-margin);
}

.chart-grid {
  .echarts {
    max-width: 100%;
    margin: 0 auto;
  }

  @media (min-width: 1280px) {
    grid-template-columns: repeat(2, 1fr);

    @media (min-width: 1600px) {
      .echarts {
        width: 600px;
        height: 400px;
        max-width: 100%;
        margin: 0 auto;
      }
    }

    @media (max-width: 1600px) {
      .echarts {
        width: 480px;
        height: 360px;
      }
    }
  }

  @media (max-width: 1280px) {
    grid-template-columns: 1fr;

    @media (min-width: 768px) {
      .echarts {
        width: 800px;
        height: 400px;
      }
    }

    @media (max-width: 768px) and (min-width: 480px) {
      .echarts {
        width: 600px;
        height: 400px;
      }
    }

    @media (max-width: 480px) {
      .echarts {
        width: 100%;
        height: 300px;
      }
    }
  }
}

</style>
