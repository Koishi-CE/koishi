/**
 * @file 合包安装的执行编排 composable(bundle-install 域)。
 *
 * 不走 shared 的 install(),单独调 market/bundle-install RPC,但复用
 * installProgressState 进度面板,并自带同样的 socket 断连竞态处理
 * (watch(socket) 构造 disconnected Promise 与任务 race)与 fallback
 * 镜像重试;断连一律按失败处理。成功后弹出 moved/skipped 统计并关闭。
 */

import { computed, ref, watch } from 'vue'
import { message, send, socket } from '@koishi-ce/client'
import type { BundleInstallResult } from '../../../src/shared/bundle'
import {
  activeBundle,
  installProgressState,
  prepareInstallFallbackRetry,
  resetInstallFallbackState,
  type InstallOptions,
} from '../../shared/operations'
import type { BundleDiff } from './use-bundle-diff'
import type { BundleMembers } from './use-bundle-members'

export function useBundleInstall(
  members: BundleMembers,
  diff: BundleDiff,
  t: (key: string, args?: any) => string,
) {
  /** 安装执行中。 */
  const installing = ref(false)

  /** 安装按钮可用条件:有目标与清单、校验通过、至少勾选一个成员、非加载中且无 JSON 编辑错误。 */
  const canInstall = computed(() => {
    return !!activeBundle.value
      && !!members.bundle.value
      && diff.validation.value.valid
      && members.selectedMembers.value.length > 0
      && !members.loading.value
      && Object.keys(members.memberJsonErrors).length === 0
  })

  /** 关闭对话框:安装进行中禁止关闭,清空 activeBundle。 */
  function close() {
    if (installing.value) return
    activeBundle.value = undefined
  }

  /** 把抛出的错误归一成可展示字符串(Error/字符串/{message} 逐级尝试)。 */
  function formatInstallError(error: unknown) {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      const value = error as any
      if (typeof value.message === 'string') return value.message
      if (typeof value.error === 'string') return value.error
    }
    return String(error || t('bundle.messages.unknownError'))
  }

  /** 安装失败统一上报:stderr 日志行 + toast。 */
  function reportInstallError(detail: string) {
    const text = detail || t('bundle.messages.unknownError')
    installProgressState.logs.push({
      type: 'stderr',
      line: t('bundle.messages.installFailed', { detail: text }),
    })
    message.error(t('bundle.messages.installFailed', { detail: text }))
  }

  /** 确认安装:点亮进度面板 → 组装请求 → 断连竞态 race → 处理退出码/fallback 重试。 */
  async function confirmInstall() {
    if (!activeBundle.value || !members.bundle.value || installing.value) return
    installing.value = true

    installProgressState.title = t('bundle.messages.installing')
    installProgressState.logs = []
    installProgressState.status = 'running'
    installProgressState.visible = true
    installProgressState.selfUpdate = false
    installProgressState.environmentRestore = false
    resetInstallFallbackState()
    installProgressState.logs.push({
      type: 'stdout',
      line: t('bundle.messages.submitted'),
    })

    const request = {
      package: activeBundle.value!.package.name,
      version: diff.bundleVersion.value,
      bundle: members.bundle.value!,
      members: members.members.map(member => ({
        ...member,
        createConfig: member.createConfig || !!member.move,
      })),
    }

    // 合包安装的成块编排:断连竞速/超时提示/退出码分支同属一次安装的时序,拆分会打散收尾配对
    // fallow-ignore-next-line complexity
    const runInstall = async (options?: InstallOptions) => {
      installing.value = true
      let disconnectedBeforeResponse = false
      let resolveDisconnected: (value: undefined) => void
      const disconnected = new Promise<undefined>((resolve) => {
        resolveDisconnected = resolve
      })
      const dispose = watch(socket, (value, previous) => {
        if (value || !previous) return
        disconnectedBeforeResponse = true
        resolveDisconnected(undefined)
        dispose()
      })
      const waitTimer = setTimeout(() => {
        if (installProgressState.status !== 'running') return
        installProgressState.logs.push({
          type: 'stdout',
          line: t('bundle.messages.waiting'),
        })
      }, 8000)
      try {
        const task = send('market/install-bundle', request, undefined, options ?? {}) as Promise<BundleInstallResult> | undefined
        const result = await Promise.race([task ?? Promise.resolve(undefined), disconnected])
        if (disconnectedBeforeResponse) {
          installProgressState.status = 'error'
          reportInstallError(t('bundle.messages.disconnected'))
          return undefined
        }
        if (result?.code) {
          installProgressState.status = 'error'
          reportInstallError(t('bundle.messages.exitCode', { code: result.code }))
          await prepareInstallFallbackRetry(runInstall, options?.installEndpoint)
          return result.code
        }
        installProgressState.status = 'success'
        const moved = result?.moved?.length ? t('bundle.messages.moved', { count: result.moved.length }) : ''
        const skipped = result?.skipped?.length ? t('bundle.messages.skipped', { count: result.skipped.length }) : ''
        message.success(t('bundle.messages.completed', { moved, skipped }))
        activeBundle.value = undefined
        return 0
      } finally {
        clearTimeout(waitTimer)
        dispose()
        installing.value = false
      }
    }

    try {
      await runInstall()
    } catch (err) {
      console.error(err)
      installProgressState.status = 'error'
      reportInstallError(formatInstallError(err))
    }
  }

  return { installing, canInstall, close, confirmInstall }
}
