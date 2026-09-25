<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<!--
  图片查看器的共享工具条：缩小 / 放大 / 复原 / 逆时针 / 顺时针五按钮。
  两套查看器（viewer.vue 容器内查看、overlay.vue 全屏查看）此前各自
  重复实现这一组按钮（审计 P1-11 的合流点），文案也自此统一走宿主
  词典 overlay.* —— 容器内查看器原为硬编码中文，且 undo / redo 的
  tooltip 文案互相写反（redo 被标成「逆时针旋转」），随本组件修正。
  悬浮样式由父组件 @include toolbar.scss 提供（类名 .button.bottom）。
-->
<template>
  <span class="button bottom" @click.stop>
    <el-tooltip placement="top" :content="t('overlay.zoomOut')" :offset="20">
      <k-icon name="search-minus" @click="ctrl.zoom(-0.2)"/>
    </el-tooltip>
    <el-tooltip placement="top" :content="t('overlay.zoomIn')" :offset="20">
      <k-icon name="search-plus" @click="ctrl.zoom(0.2)"/>
    </el-tooltip>
    <el-tooltip placement="top" :content="t('overlay.reset')" :offset="20">
      <k-icon name="expand" @click="ctrl.resetTransform()"/>
    </el-tooltip>
    <el-tooltip placement="top" :content="t('overlay.rotateLeft')" :offset="20">
      <k-icon name="undo" @click="ctrl.rotateBy(-90)"/>
    </el-tooltip>
    <el-tooltip placement="top" :content="t('overlay.rotateRight')" :offset="20">
      <k-icon name="redo" @click="ctrl.rotateBy(90)"/>
    </el-tooltip>
  </span>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import type { ImageTransformController } from "./use-transform";

defineProps<{
	/** 由父组件经 useImageTransform() 创建的变换控制器 */
	ctrl: ImageTransformController;
}>();

const { t } = useI18n();
</script>
