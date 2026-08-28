/**
 * explorer 插件（浏览器端入口）：注册文件管理器页面与配套 UI。
 *
 * - /files 路由的主页面（index.vue：左侧文件树 + 右侧 monaco 编辑器）
 * - Schema path 角色的路径选择控件（file-picker.vue，供其它插件的配置表单使用）
 * - 全局上传对话框（upload.vue）与状态栏当前语言指示（status.vue）
 * - explorer / explorer.tree 两组菜单项，供页面动作与文件树右键菜单挂载
 */

import type { Context } from "@koishi-ce/client";
import type { Entry } from "@koishi-ce/plugin-explorer";
import FilePicker from "./file-picker.vue";
import Layout from "./index.vue";
import Status from "./status.vue";
import Upload from "./upload.vue";
import "./icons";
import "./editor";

import "virtual:uno.css";
import "./editor.scss";

// 浏览器端 tsconfig 无 paths,@koishi-ce/plugin-console 解析不到真实模块,
// Console.Services 来自 packages/web/client/client/shims.d.ts 的手写环境声明;
// 这里按同名环境声明合并为其补充 explorer 键,使 ctx.page 的 fields 通过检查
declare module "@koishi-ce/plugin-console" {
	namespace Console {
		export interface Services {
			explorer: DataService<Entry[]>;
		}
	}
}

export default (ctx: Context) => {
	// 注册 path 角色的 string 控件:配置表单中的路径字段
	// 会渲染为 FilePicker 弹窗选择器
	ctx.schema({
		type: "string",
		role: "path",
		component: FilePicker,
		validate: (value) => typeof value === "string",
	});

	// 全局插槽:挂载拖拽/粘贴上传的监听对话框
	ctx.slot({
		type: "global",
		component: Upload,
	});

	// 文件管理器主页面(左侧树 + 右侧编辑器),依赖 explorer 数据服务
	ctx.page({
		id: "files",
		path: "/files/:name*",
		name: "资源管理器",
		icon: "activity:explorer",
		order: 600,
		fields: ["explorer"],
		component: Layout,
	});

	// 状态栏右侧:当前编辑文件的语言名
	ctx.slot({
		type: "status-right",
		component: Status,
	});

	// 页面级菜单(ctrl+s / ctrl+r),由 index.vue 的 ctx.action 响应
	ctx.menu("explorer", [
		{
			id: "explorer.save",
			icon: "save",
			label: "保存",
		},
		{
			id: "explorer.refresh",
			icon: "refresh",
			label: "刷新",
		},
	]);

	// 文件树右键菜单(id 以 . 开头的项挂在节点上,由 explorer.tree 上下文触发)
	ctx.menu("explorer.tree", [
		{
			id: ".create-file",
			icon: "file-create",
			label: "新建文件",
		},
		{
			id: ".create-directory",
			icon: "directory-create",
			label: "新建文件夹",
		},
		{
			id: ".upload",
			icon: "upload",
			label: "上传文件",
		},
		{
			id: ".download",
			icon: "download",
			label: "下载文件",
		},
		{
			id: "@separator",
		},
		{
			id: ".rename",
			icon: "edit",
			label: "重命名",
		},
		{
			id: ".remove",
			icon: "delete",
			type: "danger",
			label: "删除",
		},
	]);
};
