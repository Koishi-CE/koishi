<template>
  <!-- 手动添加对话框:本地包上传 / registry 包名查询两个页签,busy 时禁止误关 -->
  <el-dialog
    v-model="showManual"
    append-to-body
    align-center
    class="manual-panel local-package-dialog"
    destroy-on-close
    width="min(680px, calc(100vw - 24px))"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
  >
    <template #header>{{ t('operations.manual.title') }}</template>

    <el-tabs v-model="mode" class="manual-tabs">
      <el-tab-pane name="local">
        <template #label>
          <span class="manual-tab-label">
            <market-icon name="file-archive"></market-icon>
            <span>{{ t('operations.manual.localTab') }}</span>
          </span>
        </template>
        <local-package-upload
          :busy="busy"
          :error="uploadError"
          :preview="preview"
          :selected-filename="selectedFilename"
          :selected-size="selectedSize"
          :uploaded-bytes="uploadedBytes"
          :uploading="uploading"
          :upload-progress="uploadProgress"
          @error="setError"
          @select="uploadFile"
        ></local-package-upload>
      </el-tab-pane>

      <el-tab-pane name="registry" :disabled="busy">
        <template #label>
          <span class="manual-tab-label">
            <k-icon name="cube"></k-icon>
            <span>{{ t('operations.manual.registryTab') }}</span>
          </span>
        </template>
        <div class="registry-panel">
          <k-comment type="warning">
            <p>
              {{ t('operations.manual.hint') }}
              <router-link to="/market">{{ t('operations.manual.market') }}</router-link>
              {{ t('operations.manual.hintAfter') }}
            </p>
          </k-comment>
          <el-input
            v-model="name"
            clearable
            :aria-invalid="!!registryError"
            :class="{ invalid: !!registryError }"
            :placeholder="t('operations.manual.placeholder')"
            @keydown.enter.stop.prevent="onRegistryEnter"
          ></el-input>
          <p class="registry-status" aria-live="polite">
            <span v-if="registryLoading">{{ t('operations.manual.registryLoading') }}</span>
            <span v-else-if="registryError" class="error" role="alert">{{ registryError }}</span>
          </p>
          <dl v-if="remote" class="registry-preview">
            <div>
              <dt>{{ t('operations.manual.latest') }}</dt>
              <dd>{{ remote['dist-tags']?.latest }}</dd>
            </div>
            <div>
              <dt>{{ t('operations.manual.description') }}</dt>
              <dd>{{ remote.description || '-' }}</dd>
            </div>
          </dl>
        </div>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <div :class="['manual-footer', { 'manual-footer--local': mode === 'local' }]">
        <template v-if="mode === 'local'">
          <el-button v-if="preview || uploadError" :disabled="busy" @click="reset()">
            {{ t('operations.manual.chooseAnother') }}
          </el-button>
          <span class="manual-footer-spacer"></span>
          <el-button :disabled="committing" @click="showManual = false">
            {{ t('operations.manual.cancel') }}
          </el-button>
          <el-button type="primary" :loading="committing" :disabled="!preview || busy" @click="installPackage">
            {{ confirmText }}
          </el-button>
        </template>
        <template v-else>
          <span class="manual-footer-spacer"></span>
          <el-button @click="showManual = false">{{ t('operations.manual.cancel') }}</el-button>
          <el-button type="primary" :disabled="registryInvalid" @click="onRegistryEnter">
            {{ t('operations.manual.confirm') }}
          </el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
/**
 * @file 手动添加依赖对话框(showManual 全局开关)。
 *
 * 两个页签:本地页签把 .tgz 上传流程委托给 useLocalPackageUpload 组合式
 * (分块上传 → 预览 → 提交安装);registry 页签按包名查询元数据(防抖),
 * 确认后把最新版写入待应用 override,由 confirm.vue 统一应用。
 * 本页仅负责页签切换、registry 查询状态与重置逻辑。
 */
import type { Registry } from '@koishi-ce/registry'
import { useDebounceFn } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import LocalPackageUpload from './local-package-upload.vue'
import MarketIcon from '../../market/icons'
import { useLocalPackageUpload } from './use-local-package-upload'
import { useMarketNextI18n } from '../../shared/i18n'
import { getPendingOverrides, patchMarketNextData } from '../../shared/plugin-config'
import { addManual, showManual } from '../../shared/operations'

/** 对话框页签:local=本地包上传,registry=包名查询。 */
type ManualMode = 'local' | 'registry'

const { t } = useMarketNextI18n()
/** 当前页签 / 查询包名 / 查询结果 / 加载中与错误文案。 */
const mode = ref<ManualMode>('local')
const name = ref('')
const remote = ref<Registry>()
const registryLoading = ref(false)
const registryError = ref('')
/** 查询请求序号:响应携带过期序号时丢弃,防止旧响应覆盖新状态。 */
let registryRequest = 0

/**
 * 本地上传组合式状态(上传/预览/提交安装全在 use-local-package-upload.ts);
 * 第二个参数是安装开始前的关窗回调。
 */
const {
  busy,
  committing,
  confirmText,
  installPackage,
  preview,
  reset,
  selectedFilename,
  selectedSize,
  setError,
  uploadError,
  uploadFile,
  uploadProgress,
  uploadedBytes,
  uploading,
} = useLocalPackageUpload(t, () => {
  showManual.value = false
})

/** 确认按钮禁用条件:包名为空、加载中、有错误、结果与输入不匹配或缺最新版。 */
const registryInvalid = computed(() => {
  const query = name.value.trim()
  return !query
    || registryLoading.value
    || !!registryError.value
    || remote.value?.name !== query
    || !remote.value?.['dist-tags']?.latest
})

/** 防抖查询(500ms):addManual 拉元数据;过期响应丢弃,失败记错误文案。 */
const fetchRemote = useDebounceFn(async (query: string, request: number) => {
  try {
    const data = await addManual(query)
    if (request !== registryRequest || query !== name.value.trim()) return
    remote.value = data
  } catch (error) {
    if (request !== registryRequest || query !== name.value.trim()) return
    console.warn(error)
    registryError.value = t('operations.manual.registryLookupFailed')
  } finally {
    if (request === registryRequest) registryLoading.value = false
  }
}, 500)

/** 包名输入变化时重置查询状态并发起防抖查询。 */
watch(name, (value) => {
  const query = value.trim()
  const request = ++registryRequest
  remote.value = undefined
  registryError.value = ''
  registryLoading.value = !!query
  if (query) void fetchRemote(query, request)
})

/** 离开本地上传页签时重置其状态(取消在途上传)。 */
watch(mode, (value, previous) => {
  if (previous === 'local' && value !== 'local') void reset(true)
})

/** 对话框关闭时整体复位:本地上传状态、registry 查询状态,并回到本地页签。 */
watch(showManual, (visible) => {
  if (visible) return
  void reset(true)
  resetRegistry()
  mode.value = 'local'
})

/** registry 页签确认:把 dist-tags.latest 暂存进待应用 override 并关窗(由 confirm.vue 应用)。 */
function onRegistryEnter() {
  if (registryInvalid.value || !remote.value) return
  const packageName = remote.value.name
  const latest = remote.value['dist-tags']?.latest
  if (!latest) return
  const override = getPendingOverrides()
  override[packageName] = latest
  void patchMarketNextData({ override: { ...override } })
  showManual.value = false
}

/** 复位 registry 查询状态:作废在途请求并清空输入与结果。 */
function resetRegistry() {
  registryRequest++
  name.value = ''
  remote.value = undefined
  registryLoading.value = false
  registryError.value = ''
}
</script>

<style lang="scss" scoped src="./manual.scss"></style>
