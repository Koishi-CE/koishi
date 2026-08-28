/**
 * @file 依赖页的分类汇总 composable(dependencies 域)。
 *
 * 由包名全集逐包跑 classify 状态机,产出条目列表(items)、可更新列表、
 * 预发布屏蔽开关态、各分类计数摘要与全局加载提示。
 */

import { type Context, store } from "@koishi-ce/client";
import { type ComputedRef, computed } from "vue";
import { getConfigWriter } from "../../shared/operations";
import { getPendingOverrides } from "../../shared/plugin-config";
import {
	classify,
	getOverride,
	getUpdatePolicy,
	type ItemKind,
} from "./dependency-helpers";

/** 单个依赖条目:name + 分类 + 是否待应用/手动添加。 */
export interface DependencyItem {
	name: string;
	kind: ItemKind;
	pending: boolean;
	manual: boolean;
}

export function useDependencyClassify(
	ctx: Context,
	config: { value: unknown },
	names: ComputedRef<string[]>,
) {
	/** 全部条目(name + 分类 + pending/manual 标记)。 */
	const items = computed<DependencyItem[]>(() => {
		const configWriter = getConfigWriter(ctx);
		return names.value.map((name) => ({
			name,
			kind: classify(name, ctx, config.value, configWriter),
			pending: Object.hasOwn(getOverride(), name),
			manual: !store.dependencies?.[name] && !store.packages?.[name],
		}));
	});

	/** 可更新的包名列表(驱动"全部升级"动作)。 */
	const updates = computed(() =>
		items.value
			.filter((item) => item.kind === "updatable")
			.map((item) => item.name),
	);

	/** 是否已屏蔽预发布版本的更新检查(点击可切换)。 */
	const prereleaseBlocked = computed(
		() => !!getUpdatePolicy(config.value).updateIgnorePrerelease,
	);

	/** 各分类计数摘要(工具栏徽标 + 底部应用栏)。 */
	const summary = computed(() => {
		return {
			total: items.value.length,
			updatable: items.value.filter((item) => item.kind === "updatable").length,
			bundle: items.value.filter((item) => item.kind === "bundle").length,
			pending: Object.keys(getPendingOverrides()).length,
			unconfigured: items.value.filter((item) => item.kind === "unconfigured")
				.length,
			ignored: items.value.filter((item) => item.kind === "ignored").length,
			checkDisabled: items.value.filter(
				(item) => item.kind === "check-disabled",
			).length,
			invalid: items.value.filter((item) => item.kind === "invalid").length,
			errors: items.value.filter((item) => item.kind === "error").length,
			local: items.value.filter((item) => item.kind === "local").length,
			manual: items.value.filter((item) => item.manual).length,
		};
	});

	/** 任一包的 registry 元数据仍在拉取中(工具栏加载提示)。 */
	const refreshing = computed(() => {
		return Object.values(
			(
				store as typeof store & {
					registryStatus?: Record<string, { loading?: boolean }>;
				}
			).registryStatus ?? {},
		).some((status) => status.loading);
	});

	return { items, updates, prereleaseBlocked, summary, refreshing };
}
