// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/** dataview 专属图标注册（SVG 原样取自上游 koishi-plugin-dataview） */

import { icons } from "@koishi-ce/client";

import Database from "~icons/k/database";
import FilterOff from "~icons/k/filter-off";
import FilterOn from "~icons/k/filter-on";
import Refresh from "~icons/k/refresh";
import RgbOff from "~icons/k/rgb-off";
import RgbOn from "~icons/k/rgb-on";

icons.register("database", Database);
icons.register("refresh", Refresh);
icons.register("filter-off", FilterOff);
icons.register("filter-on", FilterOn);
icons.register("rgb-off", RgbOff);
icons.register("rgb-on", RgbOn);
