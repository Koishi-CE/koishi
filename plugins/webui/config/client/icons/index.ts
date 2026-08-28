/**
 * 注册 config 插件用到的全部自定义图标。
 *
 * 各图标为纯 SVG 的单模板组件（icons/*.vue），这里统一调用
 * client 的 icons.register 注册：activity:plugin 用于页面菜单，
 * 其余用于配置树右键菜单的菜单项。
 */
import { icons } from "@koishi-ce/client";

import AddGroup from "./add-group.vue";
import AddPlugin from "./add-plugin.vue";
import Check from "./check.vue";
import Clone from "./clone.vue";
import Manage from "./manage.vue";
import Play from "./play.vue";
import Plugin from "./plugin.vue";
import Save from "./save.vue";
import Stop from "./stop.vue";
import TrashCan from "./trash-can.vue";

icons.register("activity:plugin", Plugin);
icons.register("add-group", AddGroup);
icons.register("add-plugin", AddPlugin);
icons.register("trash-can", TrashCan);
icons.register("check", Check);
icons.register("clone", Clone);
icons.register("manage", Manage);
icons.register("play", Play);
icons.register("stop", Stop);
icons.register("save", Save);
