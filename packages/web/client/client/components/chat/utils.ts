import { reactive } from "vue";

/** chat 子模块的跨组件共享状态：当前在大图查看器（overlay）中展示的图片 */
export const shared = reactive({
	overlayImage: null as HTMLImageElement | null,
});
