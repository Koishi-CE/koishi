import { useEventListener } from "@vueuse/core";
import { computed, reactive, ref, type StyleValue } from "vue";

export interface Pointer {
	readonly clientX: number;
	readonly clientY: number;
}

export function getEventPoint(event: MouseEvent | TouchEvent): Pointer {
	if (!event.type.startsWith("touch")) return event as MouseEvent;
	const touch = [
		...(event as TouchEvent).targetTouches,
		...(event as TouchEvent).changedTouches,
	][0];
	// 触摸事件理论上必有触点;空列表时回退事件自身,避免调用处解引用崩溃
	return touch ?? (event as MouseEvent);
}

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
