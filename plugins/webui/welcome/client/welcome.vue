<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2024 Il Harper (ilharp). -->
<!-- Modifications Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  欢迎卡片：文档 / 社区论坛等入口链接，背景为开屏描线动画（splash.vue，
  移植自 koishi-plugin-telemetry，MIT），内容沉底排布。
  文案走本插件注入的全局词典（client/locales/，7 语种），
  其余扩展可通过 "welcome-choice" 插槽追加自定义入口。
-->
<template>
  <div class="k-card welcome">
    <div class="splash-layer">
      <splash></splash>
    </div>
    <div class="content">
      <h1>{{ t('welcome.title') }}</h1>
      <p>{{ t('welcome.description') }}</p>
      <div class="choices">
        <k-slot name="welcome-choice">
          <k-slot-item :order="1000">
            <a class="choice" href="https://koishi.chat" rel="noopener noreferer" target="_blank">
              <h2>{{ t('welcome.docs.title') }}</h2>
              <p>{{ t('welcome.docs.description') }}</p>
            </a>
          </k-slot-item>
          <k-slot-item :order="500">
            <a class="choice" href="https://k.ilharp.cc" rel="noopener noreferer" target="_blank">
              <h2>{{ t('welcome.forum.title') }}</h2>
              <p>{{ t('welcome.forum.description') }}</p>
            </a>
          </k-slot-item>
        </k-slot>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import Splash from "./splash.vue";

// 全局 composer：词典由本插件入口经 ctx.$i18n.extend 注入
const { t } = useI18n();
</script>

<style lang="scss">

.page-home .welcome {
  --welcome-title: 2.5rem;
  --welcome-padding: 3rem 3rem;
  --welcome-choice-padding: 0.5rem 1.5rem;
  --welcome-gap: 2rem;

  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  margin: var(--card-margin);
  // 全高卡片：动画铺满，内容沉底（对齐 splash 原版页面的观感）
  height: max(
    calc(
      100vh - var(--header-height) - var(--footer-height) - var(
          --card-margin
        ) - var(--card-margin)
    ),
    400px
  );
  padding: var(--welcome-padding);

  // 动画未挂载（prefers-reduced-motion）时回落为原紧凑卡片
  &:not(:has(.splash svg)) {
    height: auto;
  }

  .splash-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .content {
    position: relative;
  }

  h1 {
    font-size: var(--welcome-title);
    margin-top: 0;
  }

  h1 + p {
    margin: var(--welcome-gap) 0;
  }

  .choices {
    display: flex;
    flex-flow: row wrap;
    gap: var(--welcome-gap);
  }

  .choice {
    flex: 1 0 auto;
    display: inline-block;
    width: 280px;
    box-sizing: border-box;
    padding: var(--welcome-choice-padding);
    border: 1px solid var(--k-color-divider);
    border-radius: 6px;
    cursor: pointer;
    transition: var(--color-transition);

    &:hover {
      background-color: var(--k-side-color);
    }

    h2 {
      font-size: 1.25rem;
      margin-top: 1rem;
    }

    p {
      font-size: 0.9375rem;
    }
  }

  @media screen and (max-width: 768px) {
    --welcome-title: 2rem;
    --welcome-padding: 1.5rem 1.5rem;
    --welcome-gap: 1.5rem;
    --welcome-choice-padding: 0.5rem 1.5rem;
  }
}

</style>
