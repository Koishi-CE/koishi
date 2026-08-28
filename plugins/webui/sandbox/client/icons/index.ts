// 注册 sandbox 页面用的自定义图标（activity 图标集的 flask 烧瓶图标）
import { icons } from "@koishi-ce/client";
import Flask from "./flask.vue";

icons.register("activity:flask", Flask);
