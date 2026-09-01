// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** dataview 专属图标注册（SVG 原样取自上游 koishi-plugin-dataview） */

import { icons } from "@koishi-ce/client";

import Database from "./database.vue";
import FilterOff from "./filter-off.vue";
import FilterOn from "./filter-on.vue";
import Refresh from "./refresh.vue";
import RgbOff from "./rgb-off.vue";
import RgbOn from "./rgb-on.vue";

icons.register("database", Database);
icons.register("refresh", Refresh);
icons.register("filter-off", FilterOff);
icons.register("filter-on", FilterOn);
icons.register("rgb-off", RgbOff);
icons.register("rgb-on", RgbOn);
