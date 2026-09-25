// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

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
