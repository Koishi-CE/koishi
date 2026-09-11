// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import { store } from "@koishi-ce/client";
/**
 * 插件依赖环境信息的派生（原 components/utils.ts 拆出）。
 *
 * 由 store.packages 派生每个插件的依赖环境信息 envMap，
 * 供配置页展示"依赖 / 服务 / 可重用性"提示。
 */
import type { Dict } from "@koishi-ce/koishi";
import type { PackageProvider } from "@koishi-ce/plugin-config";
import { computed } from "vue";

/** 单条"注入服务"依赖的信息。 */
interface DepInfo {
	/** 是否为必需依赖 */
	required: boolean;
}

/** 单条 peer 插件依赖的信息。 */
interface PeerInfo {
	/** 是否为必需的 peerDependency（未被 peerDependenciesMeta 标记为 optional） */
	required: boolean;
	/** 该依赖插件当前是否已加载 */
	active: boolean;
}

/** 插件依赖环境汇总，驱动配置页顶部的各项提示。 */
export interface EnvInfo {
	/** 本插件实现的服务列表 */
	impl: string[];
	/** 注入的服务依赖（using/inject），键为服务名 */
	using: Dict<DepInfo>;
	/** 插件级的 peer 依赖（其它 koishi 插件），键为包名 */
	peer: Dict<PeerInfo>;
	/** 是否存在需要警示用户的情况（不可重用已运行 / 未声明 schema） */
	warning?: boolean;
}

/** 控制台核心插件包名：这些插件不允许被停用或移除。 */
export const coreDeps = [
	"@koishi-ce/plugin-console",
	"@koishi-ce/plugin-config",
	"@koishi-ce/plugin-server",
];

/**
 * 解析 peer 依赖名在 store.packages 中的实际条目。上游名（@koishijs/plugin-*）
 * 在本生态里由 shim / npm alias 占名而非真实插件：仓内占位包被 LocalScanner
 * 剔除、下游 alias 落盘后又以真实包名为键，字面名查不到时回退查对应的
 * @koishi-ce/plugin-* 再分发名（两种形态下的真实提供者都是后者）。
 *
 * 注：market/client/extensions/dep-link.vue 内联复刻了同规则（从本入口
 * 取值会拖整份 config 前端进 market 产物），改此函数须同步复核。
 */
function resolveProvider(
	packages: Dict<PackageProvider.Data> | undefined,
	name: string,
): PackageProvider.Data | undefined {
	const direct = packages?.[name];
	if (direct) return direct;
	if (!name.startsWith("@koishijs/plugin-")) return;
	return packages?.[
		`@koishi-ce/plugin-${name.slice("@koishijs/plugin-".length)}`
	];
}

/**
 * 汇总单个插件的依赖环境信息（peer 依赖 / 实现的服务 / 注入的服务 /
 * 可重用性 / schema 声明），包不存在时返回空骨架。
 *
 * @param name 插件完整包名
 */
function getEnvInfo(name: string) {
	/** 把服务名记入 using（已提供或 console 服务本身除外）。 */
	function setService(name: string, required: boolean) {
		if (services.has(name)) return;
		if (name === "console") return;
		result.using[name] = { required };
	}

	const result: EnvInfo = { impl: [], using: {}, peer: {} };
	const services = new Set<string>();
	const packages = store.packages;
	const local = packages?.[name];
	if (!packages || !local) return result;

	// 检查 peer 依赖:只关注 koishi 插件类依赖,并顺带收集其实现的服务
	for (const name in local.package.peerDependencies ?? {}) {
		if (
			!name.includes("@koishi-ce/plugin-") &&
			!name.includes("@koishijs/plugin-") &&
			!name.includes("koishi-plugin-")
		)
			continue;
		const provider = resolveProvider(packages, name);
		if (coreDeps.includes(provider?.name ?? name)) continue;
		const required =
			!local.package.peerDependenciesMeta?.[name]?.optional;
		const active = !!provider?.runtime?.id;
		result.peer[name] = { required, active };
		for (const service of provider?.manifest?.service
			.implements ?? []) {
			services.add(service);
		}
	}

	// 检查本插件实现的服务(adapter 服务由适配器体系单独处理,跳过)
	for (const name of local.manifest.service.implements) {
		if (name === "adapter") continue;
		result.impl.push(name);
	}

	// 检查注入的服务依赖:required 来自 inject.required,optional 来自其余
	for (const name of local.runtime?.required ?? []) {
		setService(name, true);
	}
	for (const name of local.runtime?.optional ?? []) {
		setService(name, false);
	}

	// 检查可重用性:已在运行且不可 fork 的插件,再启用一份可能出问题
	if (local.runtime?.id && !local.runtime?.forkable) {
		result.warning = true;
	}

	// 检查 schema:未声明配置项的插件通常并非预期
	if (!local.runtime?.schema) {
		result.warning = true;
	}

	return result;
}

/** 各插件的依赖环境信息表（键为完整包名，不含全局设置条目）。 */
export const envMap = computed(() => {
	return Object.fromEntries(
		Object.keys(store.packages ?? {})
			.filter((x) => x)
			.map((name) => [name, getEnvInfo(name)]),
	);
});
