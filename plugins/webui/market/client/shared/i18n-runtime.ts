/**
 * @file i18n 命名空间的补齐与守护机制(shared 域,被 i18n.ts 消费)。
 *
 * 模块职责:
 * - ensureLocaleNamespace:对比"已注册词条"与"应有词条",把缺失部分
 *  merge 回 composer,保证本插件的翻译在任何时机都完整可用;
 * - installLocaleNamespaceGuard:劫持 composer.setLocaleMessage——旧版本
 *  bundle 通过它整体恢复 locale 快照时,会把新装插件的词条一起抹掉,
 *  guard 在每次 set 后自动重新补齐本插件的命名空间。
 *
 * 关键设计:
 * - guard 以 Symbol.for 注册在 globalThis 上的 WeakMap 里,按 composer 实例
 *  共享:同一页面上新旧两个版本的 market-next 共用一个 guard,后注册者的
 *  ensure 覆盖前者,保证补齐的是最新词条;
 * - applying 标记防止 ensure 内部的 merge 触发 guard 递归。
 */

/** composer 侧需要的三个词条读写方法的最小结构。 */
export interface LocaleMessageComposer {
  getLocaleMessage(locale: string): unknown
  mergeLocaleMessage(locale: string, messages: Record<string, unknown>): void
  setLocaleMessage(locale: string, messages: Record<string, unknown>): void
}

/** 某命名空间的全部词条:locale → 命名空间 → 词条树。 */
export type LocaleNamespaceMessages = Record<string, Record<string, unknown>>

/** 类型守卫:纯对象(非 null、非数组)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 递归判定 actual 是否完整覆盖 expected 的每一个键(叶子节点要求全等)。
 * 只要缺任何一个键或值不一致即视为不完整,需要重新合并。
 */
function hasCompleteLocaleMessage(actual: unknown, expected: unknown): boolean {
  if (!isRecord(expected)) return actual === expected
  if (!isRecord(actual)) return false
  return Object.entries(expected).every(([key, value]) => {
    return hasCompleteLocaleMessage(actual[key], value)
  })
}

/**
 * 逐 locale 补齐命名空间词条:已有词条完整覆盖预期则跳过,否则把整个
 * 命名空间 merge 进去。返回是否有变更(供测试/诊断)。
 */
export function ensureLocaleNamespace(
  composer: LocaleMessageComposer,
  namespace: string,
  messages: LocaleNamespaceMessages,
) {
  let changed = false
  for (const [locale, value] of Object.entries(messages)) {
    const current = composer.getLocaleMessage(locale)
    const namespaceMessages = isRecord(current) ? current[namespace] : undefined
    if (hasCompleteLocaleMessage(namespaceMessages, value)) continue
    composer.mergeLocaleMessage(locale, { [namespace]: value })
    changed = true
  }
  return changed
}

/** 单个 composer 上的 guard 状态:applying 防递归,ensure 执行补齐。 */
interface LocaleNamespaceGuard {
  applying: boolean
  ensure(): void
}

/** guard 注册表在 globalThis 上的挂载 key(Symbol.for 保证多副本插件共享同一张表)。 */
const guardRegistryKey = Symbol.for('@koishi-ce/plugin-marketn/i18n-namespace-guards')
/** composer 实例 → guard 的全局注册表(WeakMap,composer 回收时条目自动释放)。 */
const guardRegistry = ((globalThis as any)[guardRegistryKey] ||= new WeakMap<object, LocaleNamespaceGuard>()) as WeakMap<object, LocaleNamespaceGuard>

/**
 * 为 composer 安装命名空间 guard:
 * - 首次调用时包装 setLocaleMessage,使外部(尤其是旧版 bundle 恢复快照)
 *   每次整体覆盖词条后自动触发 ensure 重新补齐;
 * - 每次调用都会用最新的 messages 重写 guard.ensure(后注册的插件副本获胜),
 *   并立即执行一次补齐。
 */
export function installLocaleNamespaceGuard(
  composer: LocaleMessageComposer,
  namespace: string,
  messages: LocaleNamespaceMessages,
) {
  let guard = guardRegistry.get(composer as object)
  if (!guard) {
    const setLocaleMessage = composer.setLocaleMessage.bind(composer)
    guard = {
      applying: false,
      ensure: () => {},
    }
    // Legacy bundles restore their locale snapshots through this method after
    // a newer entry can already be active, so the app-level guard must persist.
    composer.setLocaleMessage = (locale, value) => {
      setLocaleMessage(locale, value)
      if (!guard!.applying) guard!.ensure()
    }
    guardRegistry.set(composer as object, guard)
  }

  guard.ensure = () => {
    guard!.applying = true
    try {
      ensureLocaleNamespace(composer, namespace, messages)
    } finally {
      guard!.applying = false
    }
  }
  guard.ensure()
}
