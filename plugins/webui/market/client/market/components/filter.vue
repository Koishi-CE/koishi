<template>
  <!-- 排序组:点击选中排序键,再点一次切换升/降序 -->
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.sort') }}</h2>
    </div>
    <template v-for="(item, key) in comparators" :key="key">
      <div
        v-if="!item.hidden"
        class="market-filter-item"
        :class="{ active: activeSort[0] === key }"
        @click="toggleSort('sort:' + key, $event)">
        <span class="icon"><market-icon :name="item.icon"></market-icon></span>
        <span class="text">{{ t(`sort.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="order"><market-icon :name="activeSort[1]"></market-icon></span>
      </div>
    </template>
  </div>
  <!-- 筛选徽章组:三态切换(选中 → 反选 not:xxx → 取消),右侧显示命中计数 -->
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.filter') }}</h2>
    </div>
    <template v-for="(item, key) in badges" :key="key">
      <div
        v-if="!item.hidden?.(config ?? {}, 'filter')"
        class="market-filter-item"
        :class="{ [key]: true, active: words.includes(item.query), disabled: words.includes(item.negate) }"
        @click="toggleQuery(item, $event)">
        <span class="icon"><market-icon :name="item.icon || key"></market-icon></span>
        <span class="text">{{ t(`badge.${key}`) }}</span>
        <span class="spacer"></span>
        <span class="count" v-if="data">
          {{ badgeCounts[key] ?? 0 }}
        </span>
      </div>
    </template>
  </div>
  <!-- 高级组:相对天数(N 天内)与绝对日期(YYYY-MM-DD)六种日期过滤,可一键清空 -->
  <details class="market-filter-group market-filter-advanced" :open="advancedOpen || hasDateFilters" @toggle="onAdvancedToggle">
    <summary class="market-filter-title market-advanced-summary">
      <h2 class="text">{{ t('type.advanced') }}</h2>
      <span v-if="hasDateFilters" class="market-advanced-count">{{ activeDateFilterCount }}</span>
    </summary>
    <div class="market-date-filter">
      <label class="market-date-row">
        <span>{{ t('advanced.createdWithin') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="4"
          :placeholder="t('advanced.daysPlaceholder')"
          :value="relativeDateFilters.createdWithin"
          @input="updateRelativeDateFilterFromEvent('createdWithin', $event)"
          @keydown.enter.prevent="commitRelativeDateFilterFromEvent('createdWithin', $event)"
          @blur="commitRelativeDateFilterFromEvent('createdWithin', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedWithin') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="4"
          :placeholder="t('advanced.daysPlaceholder')"
          :value="relativeDateFilters.updatedWithin"
          @input="updateRelativeDateFilterFromEvent('updatedWithin', $event)"
          @keydown.enter.prevent="commitRelativeDateFilterFromEvent('updatedWithin', $event)"
          @blur="commitRelativeDateFilterFromEvent('updatedWithin', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.createdAfter') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.createdAfter"
          @input="updateDateFilterFromEvent('createdAfter', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('createdAfter', $event)"
          @blur="commitDateFilterFromEvent('createdAfter', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.createdBefore') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.createdBefore"
          @input="updateDateFilterFromEvent('createdBefore', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('createdBefore', $event)"
          @blur="commitDateFilterFromEvent('createdBefore', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedAfter') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.updatedAfter"
          @input="updateDateFilterFromEvent('updatedAfter', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('updatedAfter', $event)"
          @blur="commitDateFilterFromEvent('updatedAfter', $event)"
        >
      </label>
      <label class="market-date-row">
        <span>{{ t('advanced.updatedBefore') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="10"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('advanced.datePlaceholder')"
          :value="dateDrafts.updatedBefore"
          @input="updateDateFilterFromEvent('updatedBefore', $event)"
          @keydown.enter.prevent="commitDateFilterFromEvent('updatedBefore', $event)"
          @blur="commitDateFilterFromEvent('updatedBefore', $event)"
        >
      </label>
      <button v-if="hasDateFilters" class="market-date-clear" type="button" @click="clearDateFilters">
        {{ t('advanced.clearDates') }}
      </button>
    </div>
  </details>
  <!-- 分类组:单选切换,再次点击取消;右侧显示各类目计数 -->
  <div class="market-filter-group">
    <div class="market-filter-title">
      <h2 class="text">{{ t('type.category') }}</h2>
    </div>
    <div
      v-for="key in categories" :key="key" class="market-filter-item"
      :class="{ active: words.includes('category:' + key) }"
      @click="toggleCategory('category:' + key, $event)">
      <span class="icon"><market-icon :name="'solid:' + key"></market-icon></span>
      <span class="text">{{ t(`category.${key}`) }}</span>
      <span class="spacer"></span>
      <span class="count" v-if="data">
        {{ categoryCounts[key] ?? 0 }}
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * @file 市场侧栏筛选组件(market 域)。
 *
 * 模块职责:渲染排序/徽章/高级日期/分类四组筛选项,把用户操作编码进
 * 查询词数组(v-model:string[],与搜索框共用同一词表);徽章与分类右侧
 * 显示基于 props.data 的实时命中计数。
 *
 * 关键设计:
 * - 所有状态都以"查询词"为唯一事实源,组件内部 words 只是镜像,
 *  watch modelValue 同步回来,保证搜索框与侧栏可互操作;
 * - 日期过滤有草稿机制:输入未满 YYYY-MM-DD 前只更新输入框显示,
 *  值完整才写入查询词;相对天数过滤即时生效。
 */

import { computed, inject, ref, watch } from 'vue'
import { Badge, badges, kConfig, comparators, categories, isBundleSearchObject, resolveCategory, useMarketI18n } from '../utils'
import { SearchObject } from '@koishi-ce/registry'
import MarketIcon from '../icons'

const props = defineProps<{
  /** 当前查询词表(末尾恒有草稿槽空串)。 */
  modelValue: string[]
  /** 用于统计徽章/分类计数的数据集(通常已是可见性过滤后的列表)。 */
  data?: SearchObject[]
}>()

const emit = defineEmits(['update:modelValue'])

const { t } = useMarketI18n()

/** 注入的市场配置(installed 判定等,由市场页 provide)。 */
const config = inject(kConfig, {})

/** 查询词镜像(末尾空串为草稿槽,与搜索框约定一致)。 */
const words = ref<string[]>([''])
/** 高级折叠组是否被用户手动展开。 */
const advancedOpen = ref(false)
/** 受支持的排序键(用于把词表里的 sort:xxx 解析回安全枚举)。 */
const supportedSorts = ['default', 'recommend', 'download', 'created', 'updated'] as const
/** 四个绝对日期输入框的草稿(值未完整时不写回词表)。 */
const dateDrafts = ref<Record<DateFilterKey, string>>({
  createdAfter: '',
  createdBefore: '',
  updatedAfter: '',
  updatedBefore: '',
})

/** 当前生效的排序:[排序键, 方向];无 sort: 词时为 default/desc。 */
const activeSort = computed<string[]>(() => {
  let word = words.value.find(w => w.startsWith('sort:'))
  if (!word) return ['default', 'desc']
  word = word.slice(5)
  if (word.endsWith('-desc')) {
    const key = word.slice(0, -5)
    return [supportedSorts.includes(key as typeof supportedSorts[number]) ? key : 'default', 'desc']
  } else if (word.endsWith('-asc')) {
    const key = word.slice(0, -4)
    return [supportedSorts.includes(key as typeof supportedSorts[number]) ? key : 'default', 'asc']
  } else {
    return [supportedSorts.includes(word as typeof supportedSorts[number]) ? word : 'default', 'desc']
  }
})

/** 绝对日期过滤的词法:新操作符 >=/<= 与 legacy 操作符 >/< 都要能读。 */
const dateFilterDefs = {
  createdAfter: { prefix: 'created:', operator: '>=', legacy: '>' },
  createdBefore: { prefix: 'created:', operator: '<=', legacy: '<' },
  updatedAfter: { prefix: 'updated:', operator: '>=', legacy: '>' },
  updatedBefore: { prefix: 'updated:', operator: '<=', legacy: '<' },
} as const

type DateFilterKey = keyof typeof dateFilterDefs

/** 从词表读出的四个绝对日期过滤值(空串表示未启用)。 */
const dateFilters = computed<Record<DateFilterKey, string>>(() => ({
  createdAfter: readDateFilter('createdAfter'),
  createdBefore: readDateFilter('createdBefore'),
  updatedAfter: readDateFilter('updatedAfter'),
  updatedBefore: readDateFilter('updatedBefore'),
}))

/** 从词表读出的两个相对天数过滤值(N 天内)。 */
const relativeDateFilters = computed<Record<RelativeDateFilterKey, string>>(() => ({
  createdWithin: readRelativeDateFilter('createdWithin'),
  updatedWithin: readRelativeDateFilter('updatedWithin'),
}))
/** 是否存在任意日期过滤(驱动高级组强制展开与角标)。 */
const hasDateFilters = computed(() => [
  ...Object.values(dateFilters.value),
  ...Object.values(relativeDateFilters.value),
].some(Boolean))
/** 生效中的日期过滤条数(高级组标题右侧角标)。 */
const activeDateFilterCount = computed(() => [
  ...Object.values(dateFilters.value),
  ...Object.values(relativeDateFilters.value),
].filter(Boolean).length)

/** 相对天数过滤的词法。 */
const relativeDateFilterDefs = {
  createdWithin: { token: 'created:within:' },
  updatedWithin: { token: 'updated:within:' },
} as const

type RelativeDateFilterKey = keyof typeof relativeDateFilterDefs

// 外部词表变化时同步镜像并刷新日期草稿(搜索框删词等场景)
watch(() => props.modelValue, (value) => {
  words.value = normalizeWords(value.slice())
  syncDateDrafts()
}, { immediate: true, deep: true })

/** 徽章命中计数:遍历 data 逐项判定各徽章条件;data 未传时全 0。 */
const badgeCounts = computed(() => {
  const result: Record<string, number> = Object.fromEntries(Object.keys(badges).map(key => [key, 0]))
  if (!props.data) return result
  const newbornAfter = Date.now() - 7 * 86400000
  for (const item of props.data) {
    if (config.installed?.(item)) result.installed++
    if (item.verified) result.verified++
    if (item.insecure) result.insecure++
    if (item.manifest?.preview) result.preview++
    if (item.portable) result.portable++
    if (isBundleSearchObject(item)) result.bundle++
    if (Date.parse(item.createdAt) >= newbornAfter) result.newborn++
  }
  return result
})

/** 分类命中计数:按 resolveCategory 归一后统计(未知类目不计数)。 */
const categoryCounts = computed(() => {
  const result: Record<string, number> = {}
  if (!props.data) return result
  for (const key of categories) result[key] = 0
  for (const item of props.data) {
    const category = resolveCategory(item.category)
    if (category in result) result[category]++
  }
  return result
})

/** 在草稿槽之前插入一个词(保持末尾空串)。 */
function addWord(word: string) {
  emitWords([...words.value.slice(0, -1), word])
}

/**
 * 点击排序项。recommend 是单向的(只切换选中,不切方向);其余键在
 * "选中(默认降序) → 升序 → 回到降序"间循环;首次点 default 直接给
 * 升序(因为无词状态本就是 default 降序)。
 */
function toggleSort(word: string, event: MouseEvent) {
  if (word === 'sort:recommend') {
    const index = words.value.findIndex(x => x.startsWith('sort:'))
    if (index === -1) addWord(word)
    else words.value[index] = word
    emitWords(words.value)
    return
  }
  const index = words.value.findIndex(x => x.startsWith('sort:'))
  if (index === -1) {
    if (word === 'sort:default') {
      addWord('sort:default-asc')
    } else {
      addWord(word)
    }
  } else if (words.value[index] === word || words.value[index] === word + '-desc') {
    words.value[index] = word + '-asc'
  } else if (words.value[index] === word + '-asc') {
    words.value[index] = word
  } else {
    words.value[index] = word
  }
  emitWords(words.value)
}

/** 点击分类:单选;点已选中的分类则取消(移除该词)。 */
function toggleCategory(word: string, event: MouseEvent) {
  const index = words.value.findIndex(x => x.startsWith('category:'))
  if (index === -1) {
    addWord(word)
  } else if (words.value[index] === word) {
    words.value.splice(index, 1)
  } else {
    words.value[index] = word
  }
  emitWords(words.value)
}

/** 点击徽章:三态循环 选中(is:xxx) → 反选(not:xxx) → 取消。 */
function toggleQuery(item: Badge, event: MouseEvent) {
  const { query, negate } = item
  const index = words.value.findIndex(x => x === query || x === negate)
  if (index === -1) {
    addWord(query)
  } else if (words.value[index] === query) {
    words.value[index] = negate
  } else {
    words.value.splice(index, 1)
  }
  emitWords(words.value)
}

/** 判定词是否属于某个绝对日期过滤(新/legacy 操作符都算)。 */
function isDateToken(word: string, key: DateFilterKey) {
  const def = dateFilterDefs[key]
  return word.startsWith(def.prefix + def.operator)
    || word.startsWith(def.prefix + def.legacy)
}

/** 判定词是否属于某个相对天数过滤。 */
function isRelativeDateToken(word: string, key: RelativeDateFilterKey) {
  const def = relativeDateFilterDefs[key]
  return word.startsWith(def.token)
}

/** 从词表读出某个绝对日期过滤的值(兼容新旧操作符)。 */
function readDateFilter(key: DateFilterKey) {
  const def = dateFilterDefs[key]
  const word = words.value?.find(word => isDateToken(word, key))
  if (!word) return ''
  if (word.startsWith(def.prefix + def.operator)) {
    return normalizeDateValue(word.slice(def.prefix.length + def.operator.length))
  }
  return normalizeDateValue(word.slice(def.prefix.length + def.legacy.length))
}

/** 日期值渐进归一:按位数补成 YYYY / YYYY-MM / YYYY-MM-DD。 */
function normalizeDateValue(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4)
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6)
}

/** 严格校验:格式合法且是真实存在的日历日期(如拒绝 02-31)。 */
function isCompleteDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(value + 'T00:00:00.000Z')
  if (!Number.isFinite(timestamp)) return false
  return new Date(timestamp).toISOString().slice(0, 10) === value
}

/**
 * 写入某个绝对日期过滤:值清空则移除词;未完整且非 force 时只留在草稿,
 * 完整(force=true 时放宽)才把旧词替换成新操作符形态写入词表。
 */
function updateDateFilter(key: DateFilterKey, value: string, force = false) {
  const normalized = normalizeDateValue(value)
  if (!normalized) {
    clearDateFilter(key)
    return
  }
  if (!force && !isCompleteDate(normalized)) return
  const next = words.value.filter(word => !isDateToken(word, key))
  const def = dateFilterDefs[key]
  next.push(def.prefix + def.operator + normalized)
  emitWords(next)
}

/** 从词表读出某个相对天数过滤的天数。 */
function readRelativeDateFilter(key: RelativeDateFilterKey) {
  const def = relativeDateFilterDefs[key]
  const word = words.value?.find(word => isRelativeDateToken(word, key))
  if (!word) return ''
  return normalizeDays(word.slice(def.token.length))
}

/** 天数值归一:取最多 4 位数字并夹在 0~9999。 */
function normalizeDays(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''
  return String(Math.max(0, Math.min(9999, Number(digits))))
}

/** 写入相对天数过滤:0/空则移除词,否则替换为新 token(即时生效)。 */
function updateRelativeDateFilter(key: RelativeDateFilterKey, value: string) {
  const days = normalizeDays(value)
  if (!days) {
    clearRelativeDateFilter(key)
    return
  }
  const next = words.value.filter(word => !isRelativeDateToken(word, key))
  const def = relativeDateFilterDefs[key]
  next.push(def.token + days)
  emitWords(next)
}

/** 相对天数输入的 @input:归一显示并立即提交。 */
function updateRelativeDateFilterFromEvent(key: RelativeDateFilterKey, event: Event) {
  const input = event.target as HTMLInputElement
  const normalized = normalizeDays(input.value)
  input.value = normalized
  updateRelativeDateFilter(key, normalized)
}

/** 绝对日期输入的 @input:归一显示、记录草稿,值完整才写词表。 */
function updateDateFilterFromEvent(key: DateFilterKey, event: Event) {
  const input = event.target as HTMLInputElement
  const normalized = normalizeDateValue(input.value)
  input.value = normalized
  dateDrafts.value[key] = normalized
  updateDateFilter(key, normalized)
}

/** 绝对日期输入的确认(Enter/失焦):即使值不完整也强制写词表。 */
function commitDateFilterFromEvent(key: DateFilterKey, event: Event) {
  const input = event.target as HTMLInputElement
  const normalized = normalizeDateValue(input.value)
  input.value = normalized
  dateDrafts.value[key] = normalized
  updateDateFilter(key, normalized, true)
}

/** 相对天数输入的确认(Enter/失焦):与 @input 行为一致。 */
function commitRelativeDateFilterFromEvent(key: RelativeDateFilterKey, event: Event) {
  const input = event.target as HTMLInputElement
  const normalized = normalizeDays(input.value)
  input.value = normalized
  updateRelativeDateFilter(key, normalized)
}

/** 移除某个绝对日期过滤词。 */
function clearDateFilter(key: DateFilterKey) {
  const next = words.value.filter(word => !isDateToken(word, key))
  emitWords(next)
}

/** 移除某个相对天数过滤词。 */
function clearRelativeDateFilter(key: RelativeDateFilterKey) {
  const next = words.value.filter(word => !isRelativeDateToken(word, key))
  emitWords(next)
}

/** 一键清空:重置日期草稿并移除词表里的全部日期类过滤词。 */
function clearDateFilters() {
  dateDrafts.value = {
    createdAfter: '',
    createdBefore: '',
    updatedAfter: '',
    updatedBefore: '',
  }
  words.value = words.value.filter(word => {
    if (Object.keys(dateFilterDefs).some(key => isDateToken(word, key as DateFilterKey))) return false
    if (Object.keys(relativeDateFilterDefs).some(key => isRelativeDateToken(word, key as RelativeDateFilterKey))) return false
    return true
  })
  emitWords(words.value)
}

/** details 的 toggle 事件:同步用户手动展开/收起状态。 */
function onAdvancedToggle(event: Event) {
  advancedOpen.value = (event.target as HTMLDetailsElement).open
}

/** 归一化词表后向父组件提交。 */
function emitWords(value: string[]) {
  words.value = normalizeWords(value)
  emit('update:modelValue', words.value)
}

/** 词表归一:去空并保证末尾有草稿槽。 */
function normalizeWords(value: string[]) {
  const tokens = value.filter(Boolean)
  return tokens.length ? [...tokens, ''] : ['']
}

/** 把词表里的绝对日期值回填到输入框草稿(外部词表变化时调用)。 */
function syncDateDrafts() {
  dateDrafts.value.createdAfter = readDateFilter('createdAfter')
  dateDrafts.value.createdBefore = readDateFilter('createdBefore')
  dateDrafts.value.updatedAfter = readDateFilter('updatedAfter')
  dateDrafts.value.updatedBefore = readDateFilter('updatedBefore')
}

</script>

<style lang="scss" scoped src="./filter.scss"></style>
