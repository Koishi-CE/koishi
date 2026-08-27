import type { App } from "vue";
import form from "./form";
import ImageViewer from "./image-viewer.vue";
import Comment from "./k-comment.vue";
import virtual from "./virtual";

import "./index.scss";

export * from "cosmokit";
export * from "./form";
export * from "./virtual";

export default function (app: App) {
	app.use(form);
	app.use(virtual);
	app.component("k-comment", Comment);
	app.component("k-image-viewer", ImageViewer);
}
