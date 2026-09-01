// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { icons } from "@koishi-ce/client";

import NavDeps from "./activity/deps.vue";
import NavMarket from "./activity/market.vue";

import Refresh from "./market/refresh.vue";
import Rocket from "./market/rocket.vue";

icons.register("activity:deps", NavDeps);
icons.register("activity:market", NavMarket);

icons.register("refresh", Refresh);
icons.register("rocket", Rocket);
