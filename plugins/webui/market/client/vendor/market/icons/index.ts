import { type Component, defineComponent, h } from "vue";

import misc from "./misc";
import outline from "./outline";
import solid from "./solid";

const registry: Record<string, Component> = {
	...misc,
	...outline,
	...solid,
};

export default defineComponent({
	props: {
		name: String,
	},
	render(props: { name?: string }) {
		const icon = props.name
			? registry[props.name]
			: undefined;
		return icon
			? h(icon, {
					class: "market-icon",
				})
			: [];
	},
});
