/**
 * status 插件的自定义图标注册：
 * 上 / 下箭头用于收发消息速率，platform 与 robot 用于机器人预览卡，
 * pulse（命名空间 analytic:）供 QPS 数值卡使用。
 */
import { icons } from "@koishi-ce/client";
import ArrowDown from "./arrow-down.vue";
import ArrowUp from "./arrow-up.vue";
import Platform from "./platform.vue";
import Pulse from "./pulse.vue";
import Robot from "./robot.vue";

icons.register("arrow-up", ArrowUp);
icons.register("arrow-down", ArrowDown);
icons.register("platform", Platform);
icons.register("analytic:pulse", Pulse);
icons.register("robot", Robot);
