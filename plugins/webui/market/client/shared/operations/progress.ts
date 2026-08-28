/**
 * @file 安装进度面板的唯一状态源与备选端点(fallback)重试(shared/operations 域)。
 *
 * installProgressState 是面板的状态机:idle(隐藏) → running(安装中) →
 * success/error(终态,展示重试/关闭按钮)。服务端转发的 install-log 广播只在
 * running 状态时追加,避免上一轮残留日志混入;安装失败后向服务端查询备选
 * registry 端点,挂上 retryFallback 回调供用户点"使用镜像重试"。
 */

import { receive, send } from '@koishi-ce/client'
import { reactive } from 'vue'
import { translate } from '../i18n'
import { endpointHost } from '../format'

/** 安装日志行:type 区分 stdout/stderr 以便进度面板着色。 */
export interface LogLine {
  type: 'stdout' | 'stderr'
  line: string
}

/**
 * 备选安装端点候选:主端点失败后提示用户可切换的 registry 镜像。
 * 注:src/shared/types.ts 存在同名类型,属跨层各自声明(共享类型由 src 层
 * 主导),此处只是 client 侧进度面板的窄化视图,不合并。
 */
interface InstallFallbackCandidate {
  endpoint: string
  label: string
  reason: string
}

/** 安装附加选项:installEndpoint 指定用哪个 registry 端点装(fallback 重试时用)。 */
export interface InstallOptions {
  installEndpoint?: string
}

/**
 * 安装进度面板的唯一状态源。status 是面板的状态机:
 * idle(隐藏) → running(安装中) → success/error(终态,展示重试/关闭按钮)。
 * selfUpdate 标记本次是否在更新本插件自身(成功后宿主会重启);
 * environmentRestore 标记是环境快照回滚而非普通安装。
 */
export const installProgressState = reactive({
  visible: false,
  status: 'idle', // 'idle' | 'running' | 'success' | 'error'
  logs: [] as LogLine[],
  title: '',
  selfUpdate: false,
  environmentRestore: false,
  fallbackCandidate: undefined as InstallFallbackCandidate | undefined,
  fallbackRunning: false,
  fallbackUsed: false,
  retryFallback: undefined as undefined | (() => Promise<void>),
})

// 服务端转发的包管理器输出:仅在安装进行中追加,防止上一轮日志混入
receive('market/install-log', (log: LogLine) => {
  if (installProgressState.status === 'running') {
    installProgressState.logs.push(log)
  }
})

/** 向进度面板追加一条本地生成的日志(i18n 文案在此处格式化)。仅供本域子模块共享。 */
export function pushInstallLog(line: string, type: LogLine['type'] = 'stdout') {
  installProgressState.logs.push({ type, line })
}

/** 每次新的安装/回滚开始前清空 fallback 相关状态,保证重试提示只出现一次。 */
export function resetInstallFallbackState() {
  installProgressState.fallbackCandidate = undefined
  installProgressState.fallbackRunning = false
  installProgressState.fallbackUsed = false
  installProgressState.retryFallback = undefined
}

/**
 * 安装失败后准备 fallback 重试:向服务端查询备选 registry 端点,有候选则在
 * 进度面板记录日志并挂上 retryFallback 回调(用户点"使用镜像重试"时执行)。
 * fallbackUsed/retryFallback 已存在时直接返回——同一次安装只提示一次。
 *
 * @param run 实际执行安装的闭包(携带 override 等上下文)
 * @param failedEndpoint 刚才失败了的端点(服务端据此避开它选候选)
 */
export async function prepareInstallFallbackRetry(run: (options?: InstallOptions) => Promise<number | undefined>, failedEndpoint?: string) {
  if (installProgressState.fallbackUsed || installProgressState.retryFallback) return
  const candidate = await (send('market/install-fallback-candidate', failedEndpoint) ?? Promise.resolve(undefined)).catch((error) => {
    console.warn(error)
    return undefined
  }) as InstallFallbackCandidate | undefined
  if (!candidate?.endpoint) return
  installProgressState.fallbackCandidate = candidate
  pushInstallLog(translate('operations.progress.fallbackLog', {
    endpoint: candidate.label || endpointHost(candidate.endpoint),
  }))
  installProgressState.retryFallback = async () => {
    if (installProgressState.fallbackRunning || installProgressState.fallbackUsed) return
    installProgressState.fallbackRunning = true
    installProgressState.fallbackUsed = true
    installProgressState.fallbackCandidate = undefined
    installProgressState.status = 'running'
    pushInstallLog(translate('operations.progress.fallbackConfirmed', { endpoint: candidate.endpoint }))
    try {
      const code = await run({ installEndpoint: candidate.endpoint })
      if (code) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.fallbackFailed', { code }), 'stderr')
      }
    } finally {
      installProgressState.fallbackRunning = false
      installProgressState.retryFallback = undefined
    }
  }
}
