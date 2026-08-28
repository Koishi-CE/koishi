/**
 * @file 合包安装:installBundle 函数族（market 域）。
 *
 * 模块职责:market/bundle-install RPC 的服务端实现。重新拉取并校验合包
 * 清单（不信任 client 传来的清单）、解析勾选成员、防直接循环引用,安装
 * 成功后写配置分组并持久化安装记录。
 *
 * 关键设计:client 传的 bundle/members 仅作选项参考,清单以 registry 元数据
 * 重新解析为准,防止伪造请求写入任意配置;安装记录（PluginBundleRecord）
 * 写入 MarketDataStore,卸载/管理对话框靠它回放当时的安装选择。
 * 契约面:installBundle 经 bundle.ts 原样转发导出。
 */
import type { Context, Dict } from "@koishi-ce/koishi";
import { maxSatisfying } from "semver";
import type { InstallOptions } from "../../core/install/types.js";
import { loadManifest } from "../../core/registry/manifest.js";
import type {
	BundleInstallMember,
	BundleInstallRequest,
	BundleInstallResult,
	PluginBundleManifest,
	PluginBundleRecord,
} from "../../shared/bundle.js";
import {
	BUNDLE_KEYWORD,
	parseBundleManifest,
	validateBundleManifest,
} from "../../shared/bundle.js";
import {
	INSTALL_REFRESH_CHANNELS,
	refreshConsole,
} from "../console/refresh.js";
import {
	type BundleConfigWriter,
	createBundleConfigWriter,
} from "./bundle-config.js";
import type { MarketDataStore } from "./data-store.js";

/**
 * 防御合包间的直接循环引用:A 的成员指向 B、B 的成员又指回 A 会让安装
 * 编排无限递归。逐成员取 registry 元数据里"满足版本范围的最高版本"解析
 * 其 koishi.bundle 清单,发现指回本合包即抛错;取元数据失败只记 debug
 * 日志跳过（循环检查是尽力而为,不阻断正常安装）。
 */
async function assertNoDirectBundleCycles(
	ctx: Context,
	packageName: string,
	members: BundleInstallMember[],
) {
	const bundleName = packageName.toLowerCase();
	for (const member of members) {
		try {
			const registry = await ctx.installer.getRegistry(member.package);
			const versions = Object.keys(registry?.versions ?? {});
			const version = maxSatisfying(versions, member.version, {
				includePrerelease: true,
			});
			if (!version) continue;
			const remote = registry?.versions?.[version];
			const bundle = parseBundleManifest(
				(remote?.koishi as { bundle?: unknown } | undefined)?.bundle,
			);
			if (
				!bundle?.members.some(
					(item) => item.package.toLowerCase() === bundleName,
				)
			)
				continue;
			throw new Error(
				`plugin bundle has a direct cycle: ${packageName} <-> ${member.package}`,
			);
		} catch (error) {
			if (error instanceof Error && error.message.includes("direct cycle"))
				throw error;
			ctx
				.logger("market")
				.debug(
					`plugin bundle cycle check skipped: bundle=${packageName}, member=${member.package}, error=${error instanceof Error ? error.message : error}`,
				);
		}
	}
}

/**
 * 从 registry 元数据重新解析并校验合包清单。client 传来的 bundle 字段
 * 不可信,此处按请求版本取远端 koishi.bundle、跑完整校验（命名/关键字/
 * 成员结构）,不通过即抛错阻断安装。
 */
async function resolveBundleManifest(
	ctx: Context,
	request: BundleInstallRequest,
): Promise<PluginBundleManifest> {
	if (!request.version) throw new Error("bundle package version is required");
	const registry = await ctx.installer.getRegistry(request.package);
	if (!registry?.versions)
		throw new Error(`bundle package metadata not loaded: ${request.package}`);
	const remote = registry.versions[request.version];
	if (!remote)
		throw new Error(
			`bundle package version not found: ${request.package}@${request.version}`,
		);
	const bundle = parseBundleManifest(
		(remote?.koishi as { bundle?: unknown } | undefined)?.bundle,
	);
	const validation = validateBundleManifest(request.package, bundle, {
		keyword: remote?.keywords?.some(
			(keyword) => keyword.toLowerCase() === BUNDLE_KEYWORD,
		),
	});
	if (!validation.valid) {
		throw new Error(`invalid plugin bundle: ${validation.errors.join("; ")}`);
	}
	return bundle!;
}

/**
 * 把 client 勾选的成员选项合并进服务端清单:以清单成员为基准,按
 * `package\nplugin` 组合键查请求里的选项,吸收 selected/createConfig/
 * usePreset/move/config,最后只留勾选项。清单里没有的请求成员自然被丢弃。
 */
function resolveSelectedMembers(
	request: BundleInstallRequest,
	manifest: PluginBundleManifest,
): BundleInstallMember[] {
	const requestMembers = new Map(
		(request.members ?? []).map((member) => [
			`${member.package}\n${member.plugin}`,
			member,
		]),
	);
	return manifest.members
		.map((member) => {
			const option = requestMembers.get(`${member.package}\n${member.plugin}`);
			return {
				...member,
				selected: !!option?.selected,
				createConfig: option?.createConfig !== false,
				usePreset: option?.usePreset === true,
				move: option?.move === true,
				config: option?.config ?? member.config,
			};
		})
		.filter((member) => member.selected);
}

/** 组装安装 override:合包自身 + 各勾选成员的精确版本请求。 */
function buildInstallDeps(
	request: BundleInstallRequest,
	selected: BundleInstallMember[],
) {
	const deps: Dict<string> = { [request.package]: request.version };
	for (const member of selected) {
		deps[member.package] = member.version;
	}
	return deps;
}

/**
 * 安装成功后构建持久化记录:逐成员标记 installedByBundle(安装前
 * package.json 里没有的算本次新装)与 configured/moved/skipped(来自
 * writer 的实际写入结果),交给调用方写入 MarketDataStore。
 * 安装失败（code 非 0）时不产出记录。
 */
function buildBundleRecord(
	request: BundleInstallRequest,
	manifest: PluginBundleManifest,
	selected: BundleInstallMember[],
	beforeDeps: Dict<string>,
	code: number,
	writer: BundleConfigWriter,
): PluginBundleRecord | undefined {
	if (code) return;
	return {
		package: request.package,
		version: request.version,
		label: manifest.label,
		groupKey: writer.group?.key,
		installedAt: Date.now(),
		members: selected.map((member) => ({
			package: member.package,
			plugin: member.plugin,
			version: member.version,
			required: member.required,
			selected: true,
			installedByBundle: !beforeDeps[member.package],
			configured: writer.configured.includes(member.package),
			moved: writer.moved.includes(member.package),
			skipped: writer.skipped.includes(member.package),
			usePreset: member.usePreset,
		})),
	};
}

/**
 * 合包安装入口:校验清单 → 解析勾选 → 防循环 → 安装（writer.write 挂进
 * 安装器的完成回调,回滚场景下不会执行写配置）→ 成功后再显式写一次配置
 * （兜底）→ 刷新 console → 持久化安装记录。返回值携带各结果明细供
 * client 弹层展示"装了什么/配了什么/跳过什么"。
 */
export async function installBundle(
	ctx: Context,
	dataStore: MarketDataStore,
	request: BundleInstallRequest,
	forced?: boolean,
	options: InstallOptions = {},
): Promise<BundleInstallResult> {
	options ||= {};
	const manifest = await resolveBundleManifest(ctx, request);
	const selected = resolveSelectedMembers(request, manifest);
	if (!selected.length)
		throw new Error("plugin bundle has no selected members");
	await assertNoDirectBundleCycles(ctx, request.package, selected);

	// 安装前先留一份依赖快照:判断哪些成员是"因本次合包而新装"
	const beforeDeps = loadManifest(ctx.baseDir).dependencies ?? {};
	const deps = buildInstallDeps(request, selected);
	const writer = createBundleConfigWriter(ctx, request, manifest, selected);

	const code = await ctx.installer.install(deps, forced, writer.write, options);
	if (!code) {
		await writer.write();
	}

	await refreshConsole(ctx, INSTALL_REFRESH_CHANNELS);
	const record = buildBundleRecord(
		request,
		manifest,
		selected,
		beforeDeps,
		code,
		writer,
	);
	if (record) await dataStore.setBundleRecord(record);
	return {
		code,
		installed: Object.keys(deps),
		configured: writer.configured,
		moved: writer.moved,
		skipped: writer.skipped,
		groupKey: writer.group?.key,
		record,
	};
}
