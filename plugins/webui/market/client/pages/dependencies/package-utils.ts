/**
 * @file 依赖卡片的纯函数工具(dependencies 域)。
 *
 * - identityMap/resolveIdentity:按包名与市场分类推断卡片身份(图标/配色/文案键);
 * - getDurationPreset/dialogDuration/normalizeDialogCount:忽略更新对话框的
 *   时长预设与数值归一。
 */

import { isBundlePackageName } from "../../../src/shared/bundle";
import { getMarketObject } from "../../market/state";
import { resolveCategory } from "../../market/utils";

export const day = 24 * 60 * 60 * 1000;

export type IgnoreDurationPreset = "forever" | "1d" | "7d" | "30d" | "custom";

const identityMap: Record<
	string,
	{ label: string; icon: string; color: string }
> = {
	adapter: {
		label: "dependencyCard.identity.adapter",
		icon: "solid:adapter",
		color: "#4d8df7",
	},
	database: {
		label: "dependencyCard.identity.database",
		icon: "solid:tool",
		color: "#21a67a",
	},
	webui: {
		label: "dependencyCard.identity.webui",
		icon: "solid:webui",
		color: "#8b6cf6",
	},
	core: {
		label: "dependencyCard.identity.core",
		icon: "solid:core",
		color: "#d89b32",
	},
	general: {
		label: "dependencyCard.identity.general",
		icon: "solid:general",
		color: "#6b8cff",
	},
	extension: {
		label: "dependencyCard.identity.extension",
		icon: "solid:extension",
		color: "#5c9ded",
	},
	manage: {
		label: "dependencyCard.identity.manage",
		icon: "solid:manage",
		color: "#26a0a7",
	},
	preset: {
		label: "dependencyCard.identity.preset",
		icon: "solid:preset",
		color: "#9b74df",
	},
	image: {
		label: "dependencyCard.identity.image",
		icon: "solid:image",
		color: "#d66aa8",
	},
	media: {
		label: "dependencyCard.identity.media",
		icon: "solid:media",
		color: "#3e9fbb",
	},
	tool: {
		label: "dependencyCard.identity.tool",
		icon: "solid:tool",
		color: "#54966f",
	},
	life: {
		label: "dependencyCard.identity.life",
		icon: "solid:life",
		color: "#8da44b",
	},
	ai: {
		label: "dependencyCard.identity.ai",
		icon: "solid:ai",
		color: "#b66be8",
	},
	meme: {
		label: "dependencyCard.identity.meme",
		icon: "solid:meme",
		color: "#d98445",
	},
	game: {
		label: "dependencyCard.identity.game",
		icon: "solid:game",
		color: "#df6b5f",
	},
	gametool: {
		label: "dependencyCard.identity.gametool",
		icon: "solid:gametool",
		color: "#c77745",
	},
	bundle: {
		label: "dependencyCard.identity.bundle",
		icon: "file-archive",
		color: "#9b74df",
	},
	other: {
		label: "dependencyCard.identity.other",
		icon: "solid:other",
		color: "#778294",
	},
};

/** 包名/分类 → 卡片身份(优先包名关键字,兜底市场分类)。 */
// 包名关键字到卡片身份的正则映射链,每行一条规则,属数据驱动的查表场景
// fallow-ignore-next-line complexity
export function resolveIdentity(name: string) {
	if (isBundlePackageName(name)) return identityMap.bundle;
	const data = getMarketObject(name);
	const category = resolveCategory(data?.category);
	const normalized = name.toLowerCase();
	if (/adapter[-/]/.test(normalized) || normalized.includes("adapter-"))
		return identityMap.adapter;
	if (/database|sqlite|mysql|mongo|postgres|redis/.test(normalized))
		return identityMap.database;
	if (/console|config|insight|market|status|telemetry/.test(normalized))
		return identityMap.webui;
	if (/loader|server|koishi$|core|sandbox/.test(normalized))
		return identityMap.core;
	if (/command|schedule|cron|help|echo|logger|locales/.test(normalized))
		return identityMap.general;
	if (/chatluna|openai|ai|llm|gpt|claude|gemini/.test(normalized))
		return identityMap.ai;
	if (/image|canvas|puppeteer|screenshot/.test(normalized))
		return identityMap.image;
	if (/rss|media|music|video|bilibili|news/.test(normalized))
		return identityMap.media;
	if (/game|chess|mahjong/.test(normalized)) return identityMap.game;
	return identityMap[category] ?? identityMap.other;
}

/** 时长(毫秒)→ 对话框预设按钮值。 */
export function getDurationPreset(duration: number): IgnoreDurationPreset {
	if (duration === day) return "1d";
	if (duration === 7 * day) return "7d";
	if (duration === 30 * day) return "30d";
	return "custom";
}

/** 对话框预设 + 自定义天数 → 时长(毫秒);forever 返回 0。 */
export function dialogDuration(
	preset: IgnoreDurationPreset,
	customDays: number,
) {
	switch (preset) {
		case "1d":
			return day;
		case "7d":
			return 7 * day;
		case "30d":
			return 30 * day;
		case "custom":
			return normalizeDialogCount(customDays, 3650) * day;
		default:
			return 0;
	}
}

/** 数值输入归一:非有限值回退 1,钳制到 [1, max] 并取整。 */
export function normalizeDialogCount(value?: number, max = 20) {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(max, Math.floor(value)));
}
