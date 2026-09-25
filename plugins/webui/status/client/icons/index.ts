// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * status 插件的自定义图标注册：
 * 上 / 下箭头用于收发消息速率，platform 与 robot 用于机器人预览卡，
 * pulse（命名空间 analytic:）供 QPS 数值卡使用。
 */
import { icons } from "@koishi-ce/client";
import Pulse from "~icons/k/analytic-pulse";
import ArrowDown from "~icons/k/arrow-down";
import ArrowUp from "~icons/k/arrow-up";
import Platform from "~icons/k/platform";
import Robot from "~icons/k/robot";

icons.register("arrow-up", ArrowUp);
icons.register("arrow-down", ArrowDown);
icons.register("platform", Platform);
icons.register("analytic:pulse", Pulse);
icons.register("robot", Robot);
