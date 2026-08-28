/**
 * 依赖图页面的悬浮提示（tooltip）逻辑。
 *
 * 提供跨鼠标 / 触摸两种输入的事件坐标提取，以及一个
 * `useTooltip()` 组合式函数：跟随指针移动、支持延迟隐藏与内容清理。
 */
import { useEventListener } from "@vueuse/core";
import { computed, reactive, ref, type StyleValue } from "vue";

/** 统一的指针位置（兼容鼠标事件与触摸事件）。 */
export interface Pointer {
	readonly clientX: number;
	readonly clientY: number;
}

/**
 * 从鼠标 / 触摸事件中提取第一个可用触点的坐标。
 *
 * @param event 鼠标或触摸事件
 * @returns 触点的 clientX/clientY；触摸事件无触点时回退为事件自身
 */
export function getEventPoint(event: MouseEvent | TouchEvent): Pointer {
	if (!event.type.startsWith("touch")) return event as MouseEvent;
	const touch = [
		...(event as TouchEvent).targetTouches,
		...(event as TouchEvent).changedTouches,
	][0];
	// 触摸事件理论上必有触点;空列表时回退事件自身,避免调用处解引用崩溃
	return touch ?? (event as MouseEvent);
}

/**
 * 创建一个跟随指针的 tooltip 状态对象。
 *
 * activate() 设置内容并开始跟随指针；deactivate() 延迟隐藏（期间若再次
 * activate 则取消隐藏）；通过 style 计算属性直接输出定位样式。
 * 返回值已 reactive 化，可在模板中以 `tooltip.active` / `tooltip.style` 使用。
 */
export function useTooltip() {
	const content = ref("");

	const active = ref(false);
	const inactive = ref(true);
	// null 表示"无定位"(display: none),与 number 区分开
	const left = ref<number | null>(0);
	const top = ref<number | null>(0);

	const style = computed<StyleValue>(() => {
		if (!left.value || !top.value) {
			return {
				display: "none",
			};
		}
		return {
			left: left.value + "px",
			top: top.value + "px",
		};
	});

	function activate(text: string, event: MouseEvent | TouchEvent) {
		const pointer = getEventPoint(event);
		content.value = text;
		active.value = true;
		inactive.value = false;
		left.value = pointer.clientX;
		top.value = pointer.clientY;
	}

	function deactivate(delay = 0, clear = false) {
		inactive.value = true;
		setTimeout(() => {
			if (!inactive.value) return;
			active.value = false;
			if (!clear) return;
			left.value = null;
			top.value = null;
		}, delay);
	}

	useEventListener("mousemove", onPointerMove);
	useEventListener("touchmove", onPointerMove);

	function onPointerMove(event: MouseEvent | TouchEvent) {
		if (inactive.value) return;
		const pointer = getEventPoint(event);
		top.value = pointer.clientY;
		left.value = pointer.clientX;
	}

	return reactive({
		style,
		content,
		active,
		inactive,
		activate,
		deactivate,
	});
}
