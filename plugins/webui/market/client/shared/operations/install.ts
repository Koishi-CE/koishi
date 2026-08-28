/**
 * @file 依赖安装与环境快照回滚的完整前端编排(shared/operations 域)。
 *
 * 关键设计:安装期间 Koishi 可能重启导致 console socket 断开——以
 * watch(socket) 构造 disconnected Promise 与 RPC 任务 race;自更新场景把
 * "断连"视作已提交而非失败。环境快照回滚复用同一套竞态框架,差异点在
 * RPC 通道与文案。
 */

import { message, send, socket } from '@koishi-ce/client'
import type { Awaitable, Dict } from 'cosmokit'
import { watch } from 'vue'
import { active } from '../plugin-config'
import { translate } from '../i18n'
import { MARKET_NEXT_PACKAGE, showEnvironmentVersions } from './state'
import {
  installProgressState,
  prepareInstallFallbackRetry,
  pushInstallLog,
  resetInstallFallbackState,
  type InstallOptions,
  type LogLine,
} from './progress'

/** 安装回调的文案覆盖项:各入口(市场/依赖页/环境回滚)传入自己的标题与提示。 */
interface InstallMessages {
  loadingText?: string
  successText?: string
  errorText?: string
  timeoutText?: string
  waitingText?: string
  /** 本次是否自更新(缺省时由 override 内容推断)。 */
  selfUpdate?: boolean
  /** 自更新断连时是否跳过 callback(默认跳过:宿主即将重启,回调无意义)。 */
  skipCallbackOnDisconnect?: boolean
  /** 非自更新场景断连是否按成功处理(默认不)。 */
  allowDisconnectSuccess?: boolean
}

/** 把任意抛出的错误归一成可展示的字符串:Error/字符串/{message}/{error} 逐级尝试。 */
function formatInstallError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as any
    if (typeof value.message === 'string') return value.message
    if (typeof value.error === 'string') return value.error
  }
  return String(error || 'unknown error')
}

/** 安装 RPC 本身失败(请求都没发成功)时的统一上报:日志 + toast,超时有专属文案。 */
function reportInstallRequestError(error: unknown, messages: InstallMessages) {
  const detail = formatInstallError(error)
  const isTimeout = detail === 'timeout'
  pushInstallLog(translate('operations.progress.requestFailed', { detail }), 'stderr')
  message.error(isTimeout
    ? messages.timeoutText ?? translate('operations.progress.installTimeout')
    : `${messages.errorText ?? translate('operations.progress.installError')}${detail ? ` ${detail}` : ''}`)
}

/** 自更新判定:覆盖清单里含有本插件包名(哪怕是卸载它)就算。 */
function isSelfUpdate(override: Dict<string>) {
  return Object.prototype.hasOwnProperty.call(override, MARKET_NEXT_PACKAGE)
}

/** install/环境回滚共用的面板重置:清 fallback、状态机归位、写入标题与首条日志。 */
function beginProgress(partial: { title: string, selfUpdate: boolean, environmentRestore: boolean, firstLogs: LogLine[] }) {
  resetInstallFallbackState()
  installProgressState.title = partial.title
  installProgressState.logs = []
  installProgressState.status = 'running'
  installProgressState.selfUpdate = partial.selfUpdate
  installProgressState.environmentRestore = partial.environmentRestore
  installProgressState.visible = true
  for (const log of partial.firstLogs) pushInstallLog(log.line, log.type)
}

/**
 * 构造与 socket 断连竞态的 disconnected Promise:宿主重启断线时以退出码 0
 * 结束 race,让上层统一走"断连分支"处理;返回的 state 供上层读取是否断连。
 */
function createDisconnectRace() {
  let resolveDisconnected: (value: number) => void
  const disconnected = new Promise<number>((resolve) => {
    resolveDisconnected = resolve
  })
  const state = { disconnectedBeforeResponse: false }
  const dispose = watch(socket, (value, previous) => {
    if (value || !previous) return
    state.disconnectedBeforeResponse = true
    resolveDisconnected(0)
    dispose()
  })
  return { disconnected, state, dispose }
}

/**
 * 依赖安装的完整前端编排:重置面板状态 → 调 market/install RPC → 处理
 * 断连竞态与退出码 → 成功时执行回调并弹 toast,失败时准备 fallback 重试。
 *
 * 断连竞态:自更新会让宿主重启、console socket 掉线——socket 先掉线且非自
 * 更新时按失败处理(普通安装不应导致重启);自更新时按"已提交"处理,并默认
 * 跳过 callback(宿主马上重启,回调没有意义)。8 秒未响应时追加"仍在等待"日志。
 *
 * @param override 覆盖清单:包名 → 版本请求(空串表示卸载)
 * @param callback 安装成功后的回调(通常触发列表刷新)
 * @param forced 是否强制安装(忽略版本比较,服务端语义)
 * @param messages 文案覆盖项
 * @returns 成功返回 0,失败返回退出码,请求失败/断连返回 undefined
 */
export async function install(override: Dict<string>, callback?: () => Awaitable<void>, forced?: boolean, messages: InstallMessages = {}) {
  const selfUpdate = messages.selfUpdate ?? isSelfUpdate(override)
  beginProgress({
    title: messages.loadingText ?? (selfUpdate
      ? translate('operations.progress.selfUpdateTitle')
      : translate('operations.progress.dependencyTitle')),
    selfUpdate,
    environmentRestore: false,
    firstLogs: [
      { type: 'stdout', line: translate('operations.progress.submitted') },
      ...(selfUpdate ? [{ type: 'stdout' as const, line: translate('operations.progress.selfSubmitted') }] : []),
    ],
  })

  const runInstall = async (options?: InstallOptions) => {
    // socket 断开时以退出码 0 结束 race:让上层逻辑统一走"断连分支"处理
    const { disconnected, state, dispose } = createDisconnectRace()
    const waitTimer = setTimeout(() => {
      if (installProgressState.status !== 'running') return
      pushInstallLog(messages.waitingText ?? (selfUpdate
        ? translate('operations.progress.waitingSelf')
        : translate('operations.progress.waitingDependencies')))
    }, 8000)
    try {
      const task = send('market/install', override, forced, options ?? {}) ?? Promise.resolve(1)
      const code = await Promise.race([task, disconnected])
      if (state.disconnectedBeforeResponse && !selfUpdate && !messages.allowDisconnectSuccess) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.disconnected'), 'stderr')
        message.warning(translate('operations.progress.disconnectedShort'))
        return undefined
      }
      if (code) {
        installProgressState.status = 'error'
        message.error(messages.errorText ?? translate('operations.progress.installError'))
        // 只有真实拿到失败退出码(而非断连)才值得换镜像重试
        if (!state.disconnectedBeforeResponse) await prepareInstallFallbackRetry(runInstall, options?.installEndpoint)
        return code
      }
      installProgressState.status = 'success'
      const shouldSkipCallback = selfUpdate
        && state.disconnectedBeforeResponse
        && messages.skipCallbackOnDisconnect !== false
      if (!shouldSkipCallback) {
        try {
          await callback?.()
        } catch (error) {
          // 断连后的回调异常不再向上抛:安装本身已成功,刷列表失败只告警
          if (!state.disconnectedBeforeResponse) throw error
          console.warn(error)
        }
      }
      if (state.disconnectedBeforeResponse && !socket.value) {
        message.success(messages.successText ?? (selfUpdate
          ? translate('operations.progress.selfSubmittedSuccess')
          : translate('operations.progress.dependenciesSubmittedSuccess')))
      } else {
        message.success(messages.successText ?? (selfUpdate
          ? translate('operations.progress.selfSuccessToast')
          : translate('operations.progress.successToast')))
      }
      return 0
    } finally {
      clearTimeout(waitTimer)
      dispose()
    }
  }

  try {
    // 收起市场条目弹层,避免安装期间残留过期的版本信息
    active.value = ''
    return await runInstall()
  } catch (err) {
    console.error(err)
    installProgressState.status = 'error'
    reportInstallRequestError(err, messages)
  }
}

/**
 * 环境快照回滚的前端编排:结构与 install 基本一致,差异点——
 * 调用的是 market/environment-snapshot-apply;environmentRestore 标记为 true
 * 让进度面板展示回滚专属文案;任何断连(除自更新)都按失败处理,不提供
 * allowDisconnectSuccess 逃生门。
 *
 * @param id 环境快照 id
 * @param selfUpdate 是否自更新(自更新断连按已提交处理)
 * @returns 成功返回 0,失败返回退出码,请求失败/断连返回 undefined
 */
export async function applyEnvironmentSnapshot(id: string, selfUpdate = false) {
  beginProgress({
    title: translate('operations.progress.environmentTitle'),
    selfUpdate: false,
    environmentRestore: true,
    firstLogs: [{ type: 'stdout', line: translate('operations.progress.environmentPreparing') }],
  })
  showEnvironmentVersions.value = false

  const runRestore = async (options?: InstallOptions) => {
    // 同 install:断连以 0 码结束 race,由上层区分"重启中"与"真失败"
    const { disconnected, state, dispose } = createDisconnectRace()
    const waitTimer = setTimeout(() => {
      if (installProgressState.status === 'running') {
        pushInstallLog(translate('operations.progress.environmentWaiting'))
      }
    }, 8000)
    try {
      const task = send('market/environment-snapshot-apply', id, options ?? {}) ?? Promise.resolve(1)
      const code = await Promise.race([task, disconnected])
      if (state.disconnectedBeforeResponse && !selfUpdate) {
        installProgressState.status = 'error'
        pushInstallLog(translate('operations.progress.environmentDisconnected'), 'stderr')
        message.warning(translate('operations.progress.environmentDisconnectedShort'))
        return
      }
      if (code) {
        installProgressState.status = 'error'
        message.error(translate('operations.progress.environmentError'))
        if (!state.disconnectedBeforeResponse) await prepareInstallFallbackRetry(runRestore, options?.installEndpoint)
        return code
      }
      installProgressState.status = 'success'
      message.success(state.disconnectedBeforeResponse
        ? translate('operations.progress.environmentSubmitted')
        : translate('operations.progress.environmentSuccess'))
      return 0
    } finally {
      clearTimeout(waitTimer)
      dispose()
    }
  }

  try {
    return await runRestore()
  } catch (error) {
    console.error(error)
    installProgressState.status = 'error'
    reportInstallRequestError(error, {
      errorText: translate('operations.progress.environmentErrorTitle'),
      timeoutText: translate('operations.progress.environmentTimeout'),
    })
  }
}
