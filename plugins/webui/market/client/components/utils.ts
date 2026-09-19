// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

import {
	type Awaitable,
	type Dict,
	loading,
	message,
	send,
	socket,
	store,
	valueMap,
} from "@koishi-ce/client";
import type { Registry } from "@koishi-ce/registry";
import { compare, satisfies } from "semver";
import { reactive, ref, watch } from "vue";
import { active } from "../utils";

export type ResultType =
	| "success"
	| "warning"
	| "danger"
	| "primary";

interface AnalyzeResult {
	peers: Dict<PeerInfo>;
	result: ResultType;
}

export interface PeerInfo {
	request: string;
	resolved: string;
	result: ResultType;
}

// getVersion 允许返回 undefined（暂存区未记录该依赖时无版本可查），
// 调用方内部以 ?? 链兜底；返回 string 的回调依然兼容本签名
export function analyzeVersions(
	name: string,
	getVersion: (name: string) => string | undefined,
): Dict<AnalyzeResult> | undefined {
	const versions =
		store.registry?.[name] || manualDeps[name]?.versions;
	if (!versions) return undefined;
	return valueMap(versions, (item) => {
		const peers = valueMap(
			{ ...item.peerDependencies },
			(request, name) => {
				const resolved =
					(getVersion ? getVersion(name) : null) ??
					store.dependencies?.[name]?.resolved ??
					store.packages?.[name]?.package.version;
				const result: ResultType = !resolved
					? item.peerDependenciesMeta?.[name]?.optional
						? "primary"
						: "danger"
					: satisfies(resolved, request, {
								includePrerelease: true,
							})
						? "success"
						: "danger";
				return { request, resolved, result } as PeerInfo;
			},
		);
		let result: "success" | "warning" | "danger" =
			"success";
		for (const peer of Object.values(peers)) {
			if (peer.result === "danger") {
				result = "danger";
				break;
			}
			if (peer.result === "warning") {
				result = "warning";
			}
		}
		if (item.deprecated) result = "danger";
		return { peers, result };
	});
}

export const manualDeps = reactive<Dict<Registry>>({});

export async function addManual(name: string) {
	const response = await fetch(
		`${store.market?.registry}/${name}`,
	);
	const data: Registry = await response.json();
	data.versions = Object.fromEntries(
		Object.entries(data.versions).sort((a, b) =>
			compare(b[0], a[0]),
		),
	);
	return (manualDeps[name] = data);
}

export const showManual = ref(false);
export const showConfirm = ref(false);

/** install 过程各节点的提示文案(缺省回退既有中文文案)。 */
export interface InstallTexts {
	loading?: string;
	success?: string;
	error?: string;
	timeout?: string;
}

const DEFAULT_INSTALL_TEXTS: Required<InstallTexts> = {
	loading: "正在更新依赖……",
	success: "安装成功！",
	error: "安装失败！",
	timeout: "安装超时！",
};

export async function install(
	override: Dict<string>,
	callback?: () => Awaitable<void>,
	forced?: boolean,
	texts?: InstallTexts,
) {
	const prompt: Required<InstallTexts> = {
		...DEFAULT_INSTALL_TEXTS,
		...texts,
	};
	const instance = loading({
		text: prompt.loading,
	});
	const dispose = watch(socket, () => {
		message.success(prompt.success);
		dispose();
		instance.close();
	});
	try {
		active.value = "";
		const code = await send(
			"market/install",
			override,
			forced,
		);
		if (code) {
			message.error(prompt.error);
		} else {
			// callback 可能返回 void 或 Promise（Awaitable），
			// 统一经 Promise.resolve 归一后等待
			await Promise.resolve(callback?.());
			message.success(prompt.success);
		}
	} catch (err) {
		console.error(err);
		message.error(prompt.timeout);
	} finally {
		dispose();
		instance.close();
	}
}
