import type { App } from "vue";
import Button from "./k-button.vue";
import Hint from "./k-hint.vue";
import Tab from "./k-tab.vue";

/** 注册公共基础组件（k-button / k-hint / k-tab） */
export default function (app: App) {
	app.component("k-button", Button);
	app.component("k-hint", Hint);
	app.component("k-tab", Tab);
}
