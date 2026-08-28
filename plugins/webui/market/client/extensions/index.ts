/**
 * @file 对宿主 @koishi-ce/plugin-config 各扩展点的补丁与插槽注册(extensions 域入口)。
 *
 * 职责:
 * - patch 掉配置树"移除"菜单项的 label 与 action:合包分组显示"卸载合包"
 *   并转交 bundle-group-uninstall 流程,普通分组/配置走 config-remove 流程,
 *   受保护的核心插件节点禁用;
 * - 注册 5 个插槽:config-remove / bundle-group-uninstall 两个全局对话框,
 *   dependency(插件依赖展示)、version(插件详情导航/卸载)、
 *   missing(未安装插件提示)、select(插件选择器分类过滤)。
 *
 * 两个 patch 都用 watch 监听宿主菜单/actions 项,宿主重建菜单后自动重打;
 * ctx.effect 注册的清理函数会恢复原始 label/action,保证插件停用后不留痕。
 */
import { Context, store } from "@koishi-ce/client";
import type { MenuItem } from "@koishi-ce/client";
// 宿主 @koishi-ce/plugin-config 提供 packages/services/config 三个 Console 服务；
// 仅在 .vue 里 import type 对 tsc 不生效，这里加载其类型声明以扩展 store。
import type {} from "@koishi-ce/plugin-config";
import { markRaw, watch } from "vue";
import ConfigRemove from "./config-remove/index.vue";
import {
	isProtectedConfigNode,
	requestConfigRemove,
} from "./config-remove/index";
import BundleGroupUninstall from "./bundle-group-uninstall/index.vue";
import { requestBundleGroupUninstall } from "./bundle-group-uninstall/index";
import Dependency from "./dependency/index.vue";
import Missing from "./missing/index.vue";
import Select from "./select/index.vue";
import Version from "./version/index.vue";
import { resolveBundlePackageFromGroup } from "../shared/operations";
import { getBundleRecords } from "../shared/plugin-config";
import { translate } from "../shared/i18n";

/** 判断配置树节点是否合包分组:分组路径能反查到合包包名即算(持久化记录优先)。 */
function isBundleGroup(tree: any) {
	if (!tree?.children) return false;
	return !!resolveBundlePackageFromGroup(tree.path, getBundleRecords());
}

/**
 * 补丁 1:改写 config.tree 菜单 ".remove" 项的 label(合包分组/分组/配置
 * 三种文案)。watch 宿主菜单项变化,宿主重挂菜单后自动重打;patched 记录
 * 原始 label 供清理时恢复。
 */
function patchConfigRemoveLabel(ctx: Context) {
	const patched = new Map<MenuItem, MenuItem["label"]>();
	const label: MenuItem["label"] = ({ config }: any) => {
		if (isBundleGroup(config.tree))
			return translate("extensions.menu.uninstallBundle");
		return config.tree?.children
			? translate("extensions.menu.removeGroup")
			: translate("extensions.menu.removeConfig");
	};
	const apply = () => {
		const list = ctx.internal.menus["config.tree"];
		const index = list?.findIndex((item) => item.id === ".remove") ?? -1;
		if (index < 0) return;
		const item = list[index];
		if (!patched.has(item)) patched.set(item, item.label);
		if (item.label === label) return;
		item.label = label;
		list.splice(index, 1, item);
	};

	ctx.effect(() => {
		const stop = watch(
			() => {
				const item = ctx.internal.menus["config.tree"]?.find(
					(item) => item.id === ".remove",
				);
				return [item, item?.label] as const;
			},
			apply,
			{ immediate: true },
		);

		return () => {
			stop();
			for (const [item, previous] of patched) {
				const list = ctx.internal.menus["config.tree"];
				const index = list?.indexOf(item) ?? -1;
				if (item.label === label) item.label = previous;
				if (index >= 0) list.splice(index, 1, item);
			}
			patched.clear();
		};
	});
}

/**
 * 补丁 2:替换 config.tree.remove action——受保护节点禁用;合包分组转交
 * 合包卸载流程,其余走配置移除流程。同样以 watch 保证补丁持续生效,
 * 清理时恢复 previous 或删掉整个 action。
 */
function patchConfigRemoveAction(ctx: Context) {
	const action = markRaw({
		disabled: ({ config }: any) =>
			!config.tree?.path || isProtectedConfigNode(config.tree),
		action: ({ config }: any) => {
			if (isBundleGroup(config.tree))
				return requestBundleGroupUninstall(config.tree);
			return requestConfigRemove(config.tree);
		},
	});

	ctx.effect(() => {
		let previous: any;

		const apply = () => {
			const current = ctx.internal.actions["config.tree.remove"];
			if (current === action) return;
			if (current) previous = current;
			ctx.internal.actions["config.tree.remove"] = action;
		};

		const stop = watch(
			() => ctx.internal.actions["config.tree.remove"],
			apply,
			{ immediate: true },
		);

		return () => {
			stop();
			if (ctx.internal.actions["config.tree.remove"] !== action) return;
			if (previous) {
				ctx.internal.actions["config.tree.remove"] = previous;
			} else {
				delete ctx.internal.actions["config.tree.remove"];
			}
		};
	});
}

/** 扩展入口:打两个菜单/动作补丁,再注册各插槽(全局对话框 + 4 个 config 插件扩展位)。 */
export default (ctx: Context) => {
	patchConfigRemoveLabel(ctx);
	patchConfigRemoveAction(ctx);

	// 配置移除确认对话框(全局挂载,由 configRemoveTarget 触发)
	ctx.slot({
		type: "global",
		component: ConfigRemove,
	});

	// 合包分组卸载对话框(全局挂载,由 bundleGroupUninstallTarget 触发)
	ctx.slot({
		type: "global",
		component: BundleGroupUninstall,
	});

	// 插件详情页的 peer 依赖/服务状态区
	ctx.slot({
		type: "plugin-dependency",
		component: Dependency,
		disabled: () => !store.packages,
	});

	// 插件详情页:外部链接导航 + 卸载入口(version.vue)
	ctx.slot({
		type: "plugin-details",
		component: Version,
		disabled: () => !store.packages,
		order: 1000,
	});

	// 插件配置指向未安装包时的"快速安装/去市场"提示(missing.vue)
	ctx.slot({
		type: "plugin-missing",
		component: Missing,
	});

	// 插件选择器的分类标签过滤(select.vue)
	ctx.slot({
		type: "plugin-select",
		component: Select,
	});
};
