<template>
  <!-- 彩蛋档案容器:头部状态行 + 动画 + 元信息/正文/出处/宣言 -->
  <section :class="['market-secret-archive', { 'is-ready': ready, 'is-copy-ready': copyReady }]">
    <header class="market-secret-archive__header">
      <code>{{ t('marketPage.easter.archive.path') }}</code>
      <span>{{ ready ? t('marketPage.easter.archive.recovered') : t('marketPage.easter.archive.recovering') }}</span>
    </header>

    <!-- 视觉主体:Koishi 之眼动画,ready/complete 驱动后续文案揭示 -->
    <div class="market-secret-archive__visual">
      <koishi-eye-splash
        class="market-secret-archive__animation"
        @ready="ready = true"
        @complete="copyReady = true"
      ></koishi-eye-splash>
    </div>

    <!-- 档案正文:元信息 → 逐段正文 → 出处 → 宣言,各段按序渐入 -->
    <div class="market-secret-archive__record">
      <dl class="market-secret-archive__meta archive-meta-reveal" style="animation-delay: 0.15s">
        <div>
          <dt>{{ t('marketPage.easter.archive.koishiVersion') }}</dt>
          <dd>{{ koishiVersion || t('marketPage.easter.archive.unknown') }}</dd>
        </div>
        <div>
          <dt>{{ t('marketPage.easter.archive.recordedAt') }}</dt>
          <dd>{{ recordedAt }}</dd>
        </div>
        <div>
          <dt>{{ t('marketPage.easter.archive.marketIndex') }}</dt>
          <dd>{{ t('marketPage.easter.archive.plugins', { count: formattedMarketCount }) }}</dd>
        </div>
      </dl>

      <article class="market-secret-archive__copy">
        <k-markdown
          v-for="(paragraph, index) in paragraphs"
          :key="index"
          class="market-secret-archive__paragraph archive-copy-reveal"
          :style="{ animationDelay: `${0.2 + index * 0.24}s` }"
          :source="paragraph"
        ></k-markdown>
      </article>

      <div
        class="market-secret-archive__source archive-copy-reveal"
        :style="{ animationDelay: `${0.3 + paragraphs.length * 0.24}s` }"
      >
        <span>{{ t('marketPage.easter.archive.sourceLabel') }}</span>
        <code>{{ t('marketPage.easter.archive.source') }}</code>
      </div>

      <p
        class="market-secret-archive__declaration archive-copy-reveal"
        :style="{ animationDelay: `${0.57 + paragraphs.length * 0.24}s` }"
      >
        {{ declaration }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * @file "秘密档案"彩蛋页(搜索词命中"恋恋世界第一"时替换市场列表展示)。
 *
 * 模块职责:把 i18n 文案 marketPage.easter.secretSearch 按空行拆成段落,
 * 最后一段作为宣言(去掉加粗标记),其余作为正文逐段渐入;配合
 * koishi-eye-splash 动画的 ready/complete 事件控制揭示节奏。
 *
 * 消费方:market.vue(secretSearchMatched 为真时渲染,并传入 Koishi
 * 版本、市场条数、触发时间三个 props)。
 */

import { computed, ref } from 'vue'
import { useMarketNextI18n } from '../../shared/i18n'
import KoishiEyeSplash from './koishi-eye-splash.vue'

const props = defineProps<{
  /** 当前 Koishi 版本(可能取不到,缺省显示"未知")。 */
  koishiVersion?: string,
  /** 市场条目总数。 */
  marketCount: number,
  /** 档案触发时间(父级在命中彩蛋时生成)。 */
  recordedAt: string,
}>()

const { t, locale } = useMarketNextI18n()
/** 动画 ready(第 287 帧):档案标题切"已恢复"。 */
const ready = ref(false)
/** 动画 complete(第 543 帧):允许正文揭示(is-copy-ready)。 */
const copyReady = ref(false)

/** 彩蛋文案按空行拆分后的全部段落(去空白段)。 */
const blocks = computed(() => t('marketPage.easter.secretSearch')
  .split(/\r?\n\s*\r?\n/)
  .map(block => block.trim())
  .filter(Boolean))

/** 正文段落:除最后一段以外的全部段。 */
const paragraphs = computed(() => blocks.value.slice(0, -1))

/** 宣言:最后一段,剥掉整体加粗的 ** 标记后纯文本展示。 */
const declaration = computed(() => {
  const value = blocks.value.at(-1) || ''
  return value.replace(/^\*\*(.*)\*\*$/s, '$1')
})

/** 市场条数的千分位本地化展示。 */
const formattedMarketCount = computed(() => props.marketCount.toLocaleString(locale.value))
</script>

<style lang="scss" src="./market-secret-archive.scss"></style>
