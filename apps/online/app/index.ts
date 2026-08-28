/**
 * k-on!（Koishi Online）前端入口。
 *
 * 在宿主控制台（@koishi-ce/client）之上注册本站专属图标与两个页面
 * （欢迎页、实例管理），随后建立"进程内回环"连接（socket.ts 的
 * ClientWebSocket，而非真实网络 WebSocket）把浏览器内的 Koishi 运行时
 * 接入控制台，最后在生产环境注册 PWA Service Worker。
 */
import { connect, global, icons, root } from "@koishi-ce/client";
import Instances from "./components/apps.vue";
import Home from "./components/home.vue";
import IconInstances from "./icons/apps.vue";
import IconDocs from "./icons/docs.vue";
import IconForum from "./icons/forum.vue";
import IconShare from "./icons/share.vue";
import ClientWebSocket from "./socket";
import "@koishi-ce/client/app";

// 注册本站专属图标（活动栏入口与分享按钮使用）
icons.register("activity:docs", IconDocs);
icons.register("activity:forum", IconForum);
icons.register("activity:instances", IconInstances);
icons.register("share", IconShare);

// 欢迎页：站点首页，介绍 k-on! 与 Koishi 并引导前往沙盒 / 插件市场
root.page({
	id: "home",
	path: "/",
	name: "欢迎",
	icon: "activity:home",
	order: 1000,
	component: Home,
});

// 实例管理页：列出、切换、新建与删除浏览器内的 Koishi 实例
root.page({
	id: "instances",
	path: "/apps",
	name: "实例管理",
	icon: "activity:instances",
	order: 900,
	component: Instances,
});

// Koishi Online 依赖仅 Chromium 内核支持的浏览器特性：其它内核直接
// 展示不支持提示；检测通过则用进程内 WebSocket 建立与本地运行时的连接
if (!("chrome" in window)) {
	global.unsupported = [
		"您的浏览器不支持 Koishi Online。",
		"请使用最新版本的 Chrome 或 Edge 浏览器。",
	];
} else {
	void connect(root, () => new ClientWebSocket());
}

// 生产环境注册 PWA Service Worker（站点外壳离线缓存）
if (process.env.NODE_ENV === "production") {
	navigator.serviceWorker?.register("/sw.js", { scope: "/" });
}
