<template>
  <!-- 动画画布(lottie 挂载点)+ 叠加的节点闪光层 -->
  <div class="koishi-eye-splash" aria-hidden="true">
    <div ref="container" :class="['koishi-eye-splash__canvas', { 'is-ready': ready }]"></div>
    <svg ref="nodeLayer" class="koishi-eye-splash__nodes" viewBox="0 0 2048 2048" preserveAspectRatio="xMidYMid slice">
      <circle v-for="node in nodePoints" :key="node.frame" class="koishi-eye-splash__node" :cx="node.x" :cy="node.y" r="7"></circle>
    </svg>
  </div>
</template>

<script setup lang="ts">
/**
 * @file Koishi 之眼 lottie 动画组件(彩蛋档案页的视觉主体)。
 *
 * 模块职责:
 * - 动态 import lottie-web(轻量版)与动画 JSON,在画布上循环播放
 *  第 25~880 帧片段;
 * - 在关键帧上叠加 SVG 节点闪光(Web Animations API),并在特定帧
 *  向父组件发 ready/complete 事件,驱动文案逐段揭示;
 * - 页面隐藏时暂停、可见时恢复,卸载时清理全部动画资源。
 *
 * 关键设计:加载失败(网络/模块缺失)时直接补发 ready+complete,
 * 保证父级文案仍能完整展示——动画是增强而非依赖。
 */

import type { AnimationItem } from 'lottie-web'
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** ready:动画播放到位(第 287 帧);complete:完整点亮(第 543 帧)。 */
const emit = defineEmits<{
  ready: [],
  complete: [],
}>()

/** lottie 挂载容器。 */
const container = ref<HTMLElement>()
/** SVG 节点闪光层。 */
const nodeLayer = ref<SVGSVGElement>()
/** lottie DOM 就绪标记(控制画布淡入)。 */
const ready = ref(false)

/** 各闪光节点被点亮的帧号与画布坐标(与动画 JSON 关键帧对齐)。 */
const nodePoints = [
  { frame: 104, x: 963, y: 1240 },
  { frame: 139, x: 1049, y: 1199 },
  { frame: 168, x: 1133, y: 1151 },
  { frame: 198, x: 1170, y: 1170 },
  { frame: 232, x: 1199, y: 1049 },
  { frame: 268, x: 1217, y: 987 },
]

/** lottie 动画实例。 */
let animation: AnimationItem | undefined
/** 组件已卸载标记(阻止异步加载完成后的初始化)。 */
let disposed = false
/** 上一帧号:检测循环回绕以重置增强状态。 */
let lastFrame = 0
/** 已点亮过的节点下标(每轮循环重置)。 */
let firedNodes = new Set<number>()
/** ready/complete 事件是否已发过(只发一次)。 */
let readyEmitted = false
let completeEmitted = false
/** 点亮完成动画是否已播放过。 */
let completionFired = false
/** is-complete 类名的移除定时器。 */
let completionTimer: ReturnType<typeof setTimeout> | undefined
/** 进行中的节点闪光动画(卸载时统一取消)。 */
const nodeAnimations = new Set<Animation>()

/** 点亮一个节点:缩放+透明度的短促闪光(WAAPI,播完自清理)。 */
function lightNode(index: number) {
  const element = nodeLayer.value?.querySelectorAll<SVGCircleElement>('.koishi-eye-splash__node')[index]
  if (!element) return
  const effect = element.animate([
    { opacity: 0, transform: 'scale(0.3)' },
    { opacity: 0.95, transform: 'scale(1)', offset: 0.35 },
    { opacity: 0, transform: 'scale(1.75)' },
  ], {
    duration: 180,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  })
  nodeAnimations.add(effect)
  effect.addEventListener('finish', () => nodeAnimations.delete(effect), { once: true })
}

/** 重置增强状态(动画循环回绕到开头时调用)。 */
function resetEnhancements() {
  firedNodes = new Set()
  completionFired = false
  container.value?.classList.remove('is-complete', 'is-extinguishing')
}

/**
 * 每帧回调:帧号回绕时重置;逐个触发到达帧号的节点闪光;
 * 第 287 帧发 ready、第 543 帧发 complete 并播放点亮完成动画;
 * 第 700 帧起进入"熄灭"状态(类名驱动样式)。
 */
// 开场动画的逐帧驱动:帧号阈值即时间轴彩蛋逻辑,拆分会打散动画时序
// fallow-ignore-next-line complexity
function updateEnhancements() {
  if (!animation) return
  const frame = animation.currentFrame + animation.firstFrame
  if (frame < lastFrame) resetEnhancements()

  nodePoints.forEach((node, index) => {
    if (frame < node.frame || firedNodes.has(index)) return
    firedNodes.add(index)
    lightNode(index)
  })

  if (frame >= 287 && !readyEmitted) {
    readyEmitted = true
    emit('ready')
  }

  if (frame >= 543 && !completeEmitted) {
    completeEmitted = true
    emit('complete')
  }

  if (frame >= 543 && !completionFired && container.value) {
    completionFired = true
    clearTimeout(completionTimer)
    container.value.classList.add('is-complete')
    container.value.animate([
      { filter: 'brightness(1)' },
      { filter: 'brightness(1.13)', offset: 0.45 },
      { filter: 'brightness(1)' },
    ], {
      duration: 260,
      easing: 'ease-out',
    })
    completionTimer = setTimeout(() => container.value?.classList.remove('is-complete'), 280)
  }

  container.value?.classList.toggle('is-extinguishing', frame >= 700)
  lastFrame = frame
}

/** 页面可见性变化:隐藏暂停、可见恢复。 */
function updatePlayback() {
  if (!animation) return
  if (document.hidden) animation.pause()
  else animation.play()
}

onMounted(async () => {
  try {
    // lottie 与动画数据都走动态 import,失败不影响文案展示
    const [{ default: lottie }, { default: splashData }] = await Promise.all([
      import('lottie-web/build/player/esm/lottie_light.min.js'),
      import('./koishi-eye-splash.json'),
    ])
    if (disposed || !container.value) return

    animation = lottie.loadAnimation({
      animationData: splashData,
      container: container.value,
      renderer: 'svg',
      loop: true,
      autoplay: false,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid slice',
      },
    })

    animation.addEventListener('DOMLoaded', () => {
      if (disposed || !animation) return
      animation.setSpeed(1.12)
      animation.playSegments([25, 880], true)
      ready.value = true
    })

    animation.addEventListener('enterFrame', updateEnhancements)

    document.addEventListener('visibilitychange', updatePlayback)
  } catch {
    // The copy remains usable if the optional animation cannot be loaded.
    // (动画加载失败时立即补发两个事件,父级文案直接全部展示)
    emit('ready')
    emit('complete')
  }
})

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(completionTimer)
  document.removeEventListener('visibilitychange', updatePlayback)
  nodeAnimations.forEach(effect => effect.cancel())
  nodeAnimations.clear()
  animation?.destroy()
  animation = undefined
})
</script>

<style lang="scss" src="./koishi-eye-splash.scss"></style>
