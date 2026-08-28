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
	ctx.schema({
		type: "string",
		role: "path",
		component: FilePicker,
		validate: (value) => typeof value === "string",
	});

	ctx.slot({
		type: "global",
		component: Upload,
	});

	ctx.page({
		id: "files",
		path: "/files/:name*",
		name: "资源管理器",
		icon: "activity:explorer",
		order: 600,
		fields: ["explorer"],
		component: Layout,
	});

	ctx.slot({
		type: "status-right",
		component: Status,
	});

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
