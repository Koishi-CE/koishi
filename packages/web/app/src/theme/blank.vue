<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!-- 404 空白页：控制台本体加载成功但没有任何扩展页面时的兜底展示 -->
<template>
  <div class="blank">
    <h1>404</h1>
    <p>{{ t('blank.hint') }}</p>
  </div>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<style lang="scss" scoped>

.blank {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 2rem;
}

</style>
