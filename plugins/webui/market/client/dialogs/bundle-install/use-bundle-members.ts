/**
 * @file 合包成员的加载/勾选/批量操作 composable(bundle-install 域)。
 *
 * 打开/切换合包时拉取 registry → 解析目标版本清单 → 并行拉成员市场元数据
 * → 逐成员计算本地冲突(same-group/other-config/package-mismatch)并生成
 * 初始勾选;预置配置 JSON 就地编辑的报错也在此管理。
 */

import { type Context, send, store, useContext } from "@koishi-ce/client";
import type { Registry } from "@koishi-ce/registry";
import { satisfies } from "semver";
import { computed, reactive, ref, watch } from "vue";
import type {
	BundleInstallMember,
	PluginBundleManifest,
	PluginBundleMember,
} from "../../../src/shared/bundle";
import { parseBundleManifest } from "../../../src/shared/bundle";
import { getBundleGroupIdent } from "../../../src/shared/bundle-idents";
import { loadMarketObjects } from "../../market/state";
import {
	activeBundle,
	getBundleMemberConfigState,
} from "../../shared/operations";
import { hasPreset } from "./bundle-format";

/** 从 registry 版本表里取目标版本条目;目标缺失时退回首个条目。 */
function resolveRemoteEntry(data: Registry, version: string) {
	if (data.versions?.[version]) {
		return [version, data.versions[version]] as const;
	}
	return Object.entries(data.versions ?? {})[0];
}

/** 拉取合包 registry 并解析目标版本(缺则首个)的清单;失败时返回错误文案。 */
async function fetchBundleManifest(
	t: (key: string, args?: any) => string,
	packageName: string,
	version: string,
): Promise<
	| { error: string; data?: Registry }
	| { data: Registry; version: string; parsed: PluginBundleManifest }
> {
	const data = (await send("market/package", packageName)) as Registry;
	if (!data?.versions) {
		return { error: t("bundle.messages.noMetadata") };
	}
	const remoteEntry = resolveRemoteEntry(data, version);
	if (!remoteEntry) {
		return { error: t("bundle.messages.noMetadata"), data };
	}
	// registry 版本条目的 koishi.bundle 字段不在官方窄化类型里,保持原样 cast
	const parsed = parseBundleManifest((remoteEntry[1] as any)?.koishi?.bundle);
	if (!parsed) {
		return { error: t("bundle.messages.noManifest"), data };
	}
	return { data, version: remoteEntry[0], parsed };
}

/** 由成员在 koishi.yml 的配置分布推导冲突类别(组内 > 组外,均无则 undefined)。 */
function pickConflictType(
	state: ReturnType<typeof getBundleMemberConfigState>,
): BundleInstallMember["conflict"] {
	if (state.group.length) return "same-group";
	if (state.external.length) return "other-config";
	return undefined;
}

/** 汇总成员的本地现状:依赖记录、是否已有配置、已装版本是否不满足范围、冲突类别。 */
function analyzeMemberLocalState(
	ctx: Context,
	member: PluginBundleMember,
	groupKey: string,
) {
	const conflictType = pickConflictType(
		getBundleMemberConfigState(ctx, member, groupKey),
	);
	const dep = store.dependencies?.[member.package];
	const isMismatch =
		dep?.resolved &&
		!satisfies(dep.resolved, member.version, { includePrerelease: true });
	const conflict: BundleInstallMember["conflict"] =
		conflictType || (isMismatch ? "package-mismatch" : undefined);
	return {
		dep,
		isMismatch,
		hasConfig: conflictType !== undefined,
		conflict,
	};
}

/** 计算单个成员的初始勾选/建配置/用预置三件套与冲突标记。 */
function resolveMemberInitState(
	ctx: Context,
	member: PluginBundleMember,
	groupKey: string,
) {
	const { dep, isMismatch, hasConfig, conflict } = analyzeMemberLocalState(
		ctx,
		member,
		groupKey,
	);
	return {
		selected: !!member.required || (!!dep && !isMismatch),
		createConfig: !hasConfig && conflict !== "same-group",
		usePreset:
			!hasConfig && !!member.config && Object.keys(member.config).length > 0,
		conflict,
	};
}

/** 补拉本地缺失的成员 registry 元数据(失败静默,结果并回 store.registry)。 */
async function loadMissingMemberRegistries(parsed: PluginBundleManifest) {
	const names = parsed.members
		.map((member) => member.package)
		.filter((name) => !store.registry?.[name]);
	if (!names.length) return;
	const result = await (
		send("market/registry", names) ?? Promise.resolve(undefined)
	).catch(() => undefined);
	// 原地逐 key 合并:只有被补拉包的依赖卡片重算,不整表替换
	if (result) {
		store.registry = store.registry ?? {};
		for (const name in result) {
			store.registry[name] = result[name];
		}
	}
}

export function useBundleMembers(t: (key: string, args?: any) => string) {
	const ctx = useContext();
	/** 清单加载中 / 加载错误文案。 */
	const loading = ref(false);
	const error = ref("");
	/** 合包的 registry 元数据(market/package 拉取)。 */
	const registry = ref<Registry>();
	/** 解析出的合包清单。 */
	const bundle = ref<PluginBundleManifest>();
	/** 实际解析到清单的合包版本(registry 里可能没有条目自带版本,取首个)。 */
	const resolvedBundleVersion = ref("");
	/** 成员勾选状态列表(直接被模板双向绑定修改)。 */
	const members = reactive<BundleInstallMember[]>([]);
	/** 各成员预置配置 JSON 编辑报错,key 为 getMemberKey。 */
	const memberJsonErrors = reactive<Record<string, string>>({});

	/** 勾选的成员 / 必装成员 / 可选成员。 */
	const selectedMembers = computed(() =>
		members.filter((member) => member.selected),
	);
	const requiredMembers = computed(() => members.filter((m) => m.required));
	const optionalMembers = computed(() => members.filter((m) => !m.required));
	/** 可选成员是否已全选(驱动"全选/全不选"按钮文案)。 */
	const allOptionalSelected = computed(
		() =>
			optionalMembers.value.length > 0 &&
			optionalMembers.value.every((m) => m.selected),
	);

	/** 成员的稳定 key:包名:插件键。 */
	function getMemberKey(member: BundleInstallMember) {
		return `${member.package}:${member.plugin}`;
	}

	/** 预置配置 JSON 就地编辑:解析成功写回 member.config 并清错,失败记录错误文案(阻断安装)。 */
	function onJsonInput(member: BundleInstallMember, value: string) {
		const key = getMemberKey(member);
		try {
			const parsed = JSON.parse(value);
			member.config = parsed;
			delete memberJsonErrors[key];
		} catch (err) {
			memberJsonErrors[key] = (err as Error).message;
		}
	}

	/** 切换成员勾选(可选成员整行/复选框共用入口)。 */
	function toggleMember(member: BundleInstallMember) {
		member.selected = !member.selected;
	}

	/** 一键切换全部可选成员的勾选状态。 */
	function toggleAllOptional() {
		const target = !allOptionalSelected.value;
		for (const m of optionalMembers.value) m.selected = target;
	}

	/** 批量设置"创建配置":same-group 冲突的成员不可建;关闭时连带关掉预置配置。 */
	function batchSetCreateConfig(value: boolean) {
		for (const m of selectedMembers.value) {
			if (m.conflict !== "same-group") {
				m.createConfig = value;
				if (!value) {
					m.usePreset = false;
				}
			}
		}
	}

	/** 批量设置"使用预置配置":仅对有预置、建配置且不涉及移动的成员生效。 */
	function batchSetUsePreset(value: boolean) {
		for (const m of selectedMembers.value) {
			if (hasPreset(m) && m.createConfig && !m.move) {
				m.usePreset = value;
			}
		}
	}

	/** 清空上一次合包的加载状态(关闭或切换合包时先回到空白)。 */
	function resetBundleState() {
		error.value = "";
		registry.value = undefined;
		bundle.value = undefined;
		resolvedBundleVersion.value = "";
		members.splice(0);
		Object.keys(memberJsonErrors).forEach(
			(key) => delete memberJsonErrors[key],
		);
	}

	/**
	 * 打开/切换合包时的加载流程:清空旧状态 → 拉取 registry → 取条目版本对应
	 * (缺则首个)的 koishi.bundle 清单 → 并行拉成员的市场元数据 → 逐成员计算
	 * 与本地现状的冲突并生成初始勾选,最后补拉缺失成员的 registry 元数据。
	 */
	watch(
		activeBundle,
		async (value) => {
			resetBundleState();
			if (!value) return;
			loading.value = true;
			try {
				const result = await fetchBundleManifest(
					t,
					value.package.name,
					value.package.version,
				);
				if ("error" in result) {
					// 拉到 registry 的失败分支仍保留元数据供版本列表展示
					if (result.data) registry.value = result.data;
					error.value = result.error;
					return;
				}
				registry.value = result.data;
				resolvedBundleVersion.value = result.version;
				bundle.value = result.parsed;
				void loadMarketObjects(
					result.parsed.members.map((member) => member.package),
				).catch((err) => {
					console.error(
						"[market-next] failed to load bundle member metadata",
						err,
					);
				});
				const groupKey = `group:${getBundleGroupIdent(value.package.name)}`;
				for (const member of result.parsed.members) {
					members.push({
						...member,
						...resolveMemberInitState(ctx, member, groupKey),
						move: false,
					});
				}
				await loadMissingMemberRegistries(result.parsed);
			} catch (err) {
				console.error(err);
				error.value =
					err instanceof Error ? err.message : t("bundle.messages.loadFailed");
			} finally {
				loading.value = false;
			}
		},
		{ immediate: true },
	);

	return {
		loading,
		error,
		registry,
		bundle,
		resolvedBundleVersion,
		members,
		memberJsonErrors,
		selectedMembers,
		requiredMembers,
		optionalMembers,
		allOptionalSelected,
		getMemberKey,
		onJsonInput,
		toggleMember,
		toggleAllOptional,
		batchSetCreateConfig,
		batchSetUsePreset,
	};
}

export type BundleMembers = ReturnType<typeof useBundleMembers>;
