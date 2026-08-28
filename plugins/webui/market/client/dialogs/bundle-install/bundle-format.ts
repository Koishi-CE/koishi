/**
 * @file 合包成员的展示辅助函数(bundle-install 域)。
 *
 * 成员分类图标/描述(多语言挑选)/安装状态文案/风险标签/敏感字段/预置
 * 配置格式化——全部为读取型纯函数(t/locale 由调用方注入),可独立单测。
 */

import { store } from "@koishi-ce/client";
import type { BundleInstallMember } from "../../../src/shared/bundle";
import { scanSensitiveConfig } from "../../../src/shared/bundle-idents";
import { getMarketObject } from "../../market/state";
import { resolveCategory } from "../../market/utils";

/** 成员分类图标:取市场元数据的 category,无数据由 resolveCategory 兜底。 */
export function memberCategory(name: string) {
	const data = getMarketObject(name);
	return resolveCategory(data?.category);
}

/**
 * 多语言描述挑选函数:即宿主 useI18nText() 返回的 tt,接受字符串或多语言
 * 对象,按当前 locale 回退链返回展示文本。
 */
export type DescriptionPicker = (
	message?: string | Record<string, string>,
) => string | undefined;

/** 成员描述:优先 manifest/package 的描述字段,多语言对象由注入的挑选函数取值。 */
export function getPackageDescription(name: string, pick: DescriptionPicker) {
	const data = getMarketObject(name);
	return pick(data?.manifest?.description) || pick(data?.package?.description);
}

/** 成员安装状态文案:依赖表已解析为"已安装",仅 packages 有为"已加载",否则"未安装"。 */
export function getInstalledText(
	name: string,
	t: (key: string, args?: any) => string,
) {
	const dep = store.dependencies?.[name];
	if (dep?.resolved)
		return t("bundle.members.installed", { version: dep.resolved });
	if (store.packages?.[name])
		return t("bundle.members.loaded", {
			version: store.packages[name].package.version,
		});
	return t("bundle.members.notInstalled");
}

/** 成员对应版本的 registry 元数据(弃用标记等)。 */
function versionMeta(member: BundleInstallMember) {
	return store.registry?.[member.package]?.[member.version];
}

/** 成员是否携带非空预置配置。 */
export function hasPreset(member: BundleInstallMember) {
	return !!member.config && Object.keys(member.config).length > 0;
}

/** 成员风险标签集合:市场缺失/官方认证/不安全/弃用/预览版/便携/含预置配置。 */
export function riskTags(
	member: BundleInstallMember,
	t: (key: string, args?: any) => string,
) {
	const data = getMarketObject(member.package);
	const tags: Array<{ label: string; type: string }> = [];
	if (!data)
		tags.push({ label: t("bundle.members.marketMissing"), type: "warning" });
	if (data?.verified)
		tags.push({ label: t("bundle.members.verified"), type: "success" });
	if (data?.insecure)
		tags.push({ label: t("bundle.members.insecure"), type: "danger" });
	if (data?.deprecated || versionMeta(member)?.deprecated)
		tags.push({ label: t("bundle.members.deprecated"), type: "danger" });
	if (data?.manifest?.preview)
		tags.push({ label: t("bundle.members.preview"), type: "warning" });
	if (data?.portable)
		tags.push({ label: t("bundle.members.portable"), type: "info" });
	if (hasPreset(member))
		tags.push({ label: t("bundle.members.hasPreset"), type: "warning" });
	return tags;
}

/** 成员预置配置里的敏感字段名列表(token/secret 等,scanSensitiveConfig 判定)。 */
export function sensitiveFields(member: BundleInstallMember) {
	return scanSensitiveConfig(member.config);
}

/** 预置配置查看器的 JSON 展示文本(空对象兜底)。 */
export function formatConfig(value: unknown) {
	return JSON.stringify(value ?? {}, null, 2);
}
