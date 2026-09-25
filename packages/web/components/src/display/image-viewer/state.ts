// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { reactive } from "vue";

/**
 * 图片查看的跨组件共享状态：当前在全屏查看器（overlay.vue）中展示的
 * 图片元素。写入方是聊天图片（chat/image.vue）的点击处理，读取方是
 * overlay.vue——状态本体归 image-viewer 域，chat 侧经此触发打开。
 */
export const shared = reactive({
	overlayImage: null as HTMLImageElement | null,
});
