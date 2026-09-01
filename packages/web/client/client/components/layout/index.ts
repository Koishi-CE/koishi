// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import type { App } from "vue";
import Card from "./card.vue";
import Content from "./content.vue";
import Empty from "./empty.vue";
import TabGroup from "./tab-group.vue";
import TabItem from "./tab-item.vue";

/** 注册布局组件（k-card / k-content / k-empty / k-tab-group / k-tab-item） */
export default function (app: App) {
	app.component("k-card", Card);
	app.component("k-content", Content);
	app.component("k-empty", Empty);
	app.component("k-tab-group", TabGroup);
	app.component("k-tab-item", TabItem);
}
