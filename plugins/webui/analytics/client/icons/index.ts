// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * analytics 插件的自定义图标注册（analytic: 命名空间）：
 * 用户 / 群组 / 心形用于首页数值卡，历史时钟备用。
 */
import { icons } from "@koishi-ce/client";
import Guild from "./guild.vue";
import Heart from "./heart.vue";
import History from "./history.vue";
import User from "./user.vue";

icons.register("analytic:guild", Guild);
icons.register("analytic:heart", Heart);
icons.register("analytic:history", History);
icons.register("analytic:user", User);
