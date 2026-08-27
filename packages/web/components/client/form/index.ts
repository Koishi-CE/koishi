import form from "schemastery-vue";
import type { App } from "vue";
import Computed from "./computed.vue";
import Filter from "./k-filter.vue";

form.extensions.add({
	type: "union",
	role: "computed",
	component: Computed,
});

export * from "schemastery-vue";
export { form as SchemaBase };

export default function (app: App) {
	app.use(form);
	app.component("k-filter", Filter);
}
