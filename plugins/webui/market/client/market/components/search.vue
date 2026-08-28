<template>
  <!-- 搜索框:已提交的查询词以 chip 形式展示(点击删除),末尾是自由输入框 -->
  <div class="search-box">
    <div class="search-container">
      <span
        v-for="(word, index) in displayWords"
        :key="index" class="search-word"
        :class="{ invalid: !validateWord(word) }"
        @click="onClickWord(index)"
      >{{ word }}</span>
      <input
        :placeholder="t('search.placeholder')"
        v-model="lastWord"
        ref="input"
        @blur="onBlur"
        @keydown.escape="onEscape"
        @keydown.backspace="onBackspace"
        @keydown.enter.prevent="commitInput"
        @keydown.space.prevent="commitInput"/>
    </div>
    <!-- 右侧图标:聚焦时显示搜索图标,有内容时显示清除图标 -->
    <div class="search-action" @click.stop="onClear">
      <market-icon class="search" name="search"></market-icon>
      <market-icon class="close" name="close"></market-icon>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * @file 市场搜索框组件(market 域)。
 *
 * 模块职责:把用户的自由输入拆成"查询词数组"(v-model:string[]),
 * 已提交的词渲染成可点击删除的 chip,输入中的草稿单独持有、去抖后
 * 一并提交;支持 Enter/空格提交、Backspace 删词、Esc 清草稿。
 *
 * 关键设计:words 数组恒以一个空串结尾(草稿槽位);watch modelValue
 * 回写时若用户正在输入且内容等价则跳过,避免外部同步把打字中的草稿冲掉。
 */

import { computed, ref, watch } from 'vue'
import { useMarketI18n, validateWord } from '../utils'
import { useDebounceFn } from '@vueuse/core'
import MarketIcon from '../icons'

const props = defineProps<{
  modelValue: string[]
  placeholder?: string
}>()

const emit = defineEmits(['update:modelValue'])

/** 底层 input 元素引用。 */
const input = ref<HTMLInputElement>()
/** 全量词表:已提交 token + 末尾的草稿槽(空串)。 */
const words = ref<string[]>([''])
/** 输入框中的未提交草稿。 */
const draft = ref('')

// 外部 modelValue 变化时回填本地;用户正在输入且内容等价时跳过,防止覆盖草稿
watch(() => props.modelValue, (value) => {
  const current = normalizeWords([...getCommittedWords(), draft.value])
  if (draft.value && document.activeElement === input.value && sameWords(value, current)) return
  const next = normalizeWords(value)
  words.value = next
  draft.value = next[next.length - 1] || ''
}, { immediate: true, deep: true })

/** 去抖提交:120ms 合并连续击键,maxWait 500ms 保证长输入不无限延迟。 */
const update = useDebounceFn(() => {
  emit('update:modelValue', normalizeWords([...getCommittedWords(), draft.value]))
}, 120, { maxWait: 500 })

/** 已提交的词(去掉末尾草稿槽与空串)。 */
const committedWords = computed(() => getCommittedWords())
/** 模板展示用,与 committedWords 相同。 */
const displayWords = computed(() => committedWords.value)

/** 输入框的可写绑定:写入时转小写并触发去抖提交。 */
const lastWord = computed({
  get: () => draft.value,
  set: (value) => {
    draft.value = value.toLowerCase()
    update()
  },
})

/** 点击某个词 chip:删除该词并回焦输入框。 */
function onClickWord(index: number) {
  const tokens = committedWords.value.slice()
  tokens.splice(index, 1)
  words.value = normalizeWords([...tokens, draft.value])
  emit('update:modelValue', words.value)
  input.value?.focus()
}

/** Enter/空格:把草稿提交为词(去重、转小写),清空草稿。 */
function commitInput() {
  const last = draft.value.trim().toLowerCase()
  if (!last) return
  const tokens = committedWords.value.slice()
  if (!tokens.includes(last)) {
    tokens.push(last)
  }
  draft.value = ''
  words.value = normalizeWords(tokens)
  emit('update:modelValue', words.value)
}

/** 失焦:草稿仅做 trim/小写归一,不提交(等 Enter 或去抖)。 */
function onBlur() {
  draft.value = draft.value.trim().toLowerCase()
}

/** Esc:丢弃草稿,回到已提交词的状态。 */
function onEscape() {
  draft.value = ''
  words.value = normalizeWords(committedWords.value)
  emit('update:modelValue', words.value)
}

/** Backspace 在草稿为空时:删除最后一个已提交词(输入框不随之退格)。 */
function onBackspace(event: KeyboardEvent) {
  if (draft.value === '' && committedWords.value.length) {
    event.preventDefault()
    const tokens = committedWords.value.slice(0, -1)
    words.value = normalizeWords(tokens)
    emit('update:modelValue', words.value)
  }
}

/** 清空按钮:草稿与全部已提交词一并清掉。 */
function onClear() {
  draft.value = ''
  words.value = ['']
  emit('update:modelValue', words.value)
}

/** 聚焦输入框(经 defineExpose 暴露给父级,Ctrl+K 快捷键用)。 */
function focus() {
  input.value?.focus()
}

/** 词表归一:去掉空串后保证末尾有且仅有一个草稿槽。 */
function normalizeWords(value: string[]) {
  const tokens = value.filter(Boolean)
  return tokens.length ? [...tokens, ''] : ['']
}

/** 取已提交词:去掉末尾草稿槽并过滤空串。 */
function getCommittedWords() {
  return words.value.slice(0, -1).filter(Boolean)
}

/** 归一化后逐项比较,判定两份词表是否等价。 */
function sameWords(a: string[], b: string[]) {
  const left = normalizeWords(a)
  const right = normalizeWords(b)
  return left.length === right.length && left.every((word, index) => word === right[index])
}

defineExpose({ focus })

const { t } = useMarketI18n()

</script>

<style lang="scss" scoped src="./search.scss"></style>
