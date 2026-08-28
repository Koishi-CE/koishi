/**
 * @file 市场页彩蛋 composable(market 页域)。
 *
 * 搜索词归一化(NFKC)后先含"恋恋"、随后含"世界第一"时命中彩蛋,
 * 整页切换为 market-secret-archive;首次触发记录归档时间并滚回顶部。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { store } from '@koishi-ce/client'


export function useMarketEaster(
  words: Ref<string[]>,
  data: ComputedRef<unknown[]>,
  locale: { value: string },
  onMatched: () => void,
) {
  /** 彩蛋判定:归一化(NFKC)后的搜索内容先含"恋恋"、随后含"世界第一"。 */
  const secretSearchMatched = computed(() => {
    const source = words.value.join('').normalize('NFKC')
    const prefixIndex = source.indexOf('恋恋')
    return prefixIndex >= 0 && source.indexOf('世界第一', prefixIndex + 2) >= 0
  })

  /** 彩蛋档案的"归档时间"(首次触发彩蛋时记录)。 */
  const secretArchiveRecordedAt = ref('')

  /** 当前 Koishi 版本(依赖表/包表多路兜底),供彩蛋档案展示。 */
  const secretArchiveKoishiVersion = computed(() => {
    return store.dependencies?.koishi?.resolved
      || store.packages?.koishi?.package.version
      || store.dependencies?.['@koishijs/core']?.resolved
      || store.packages?.['@koishijs/core']?.package.version
  })

  /** 市场总条数:优先服务端 total,退化为本地数据量(彩蛋档案展示)。 */
  const secretArchiveMarketCount = computed(() => store.market?.total || data.value.length)

  // 触发彩蛋时记录时间
  watch(secretSearchMatched, (matched) => {
    if (!matched) return
    secretArchiveRecordedAt.value = new Date().toLocaleString(locale.value)
    onMatched()
  })

  return { secretSearchMatched, secretArchiveRecordedAt, secretArchiveKoishiVersion, secretArchiveMarketCount }
}
