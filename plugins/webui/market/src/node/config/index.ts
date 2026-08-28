/**
 * @file 插件配置 Schema 定义与配置补丁白名单(config 域)。
 *
 * 模块职责:
 * - Config 接口 + Koishi Schema:声明 koishi.yml 中本插件节点的全部字段,
 *   汇聚 installer(registry)与 market(search)两个子配置块;
 * - configPatchKeys / configReloadKeys:market/update-config RPC 允许写回的
 *   键白名单,以及写回后需要热 reload 插件的键集合;
 * - normalizeMarketSilentRules:把 market 静默过滤规则(含旧版 date/days/
 *   query 字段)归一成统一的 {type, value} 形态。
 *
 * 关键设计:
 * - 大量字段标记 hidden:只允许经由本插件的前端 UI / update-config 白名单
 *   写入,避免用户在 koishi.yml 里手写出错;
 * - 旧版分散的静默规则键(status/date/recent/custom)保留为隐藏字段以兼容
 *   已有配置文件,新数据统一落 marketSilentRules;
 * - Schema 文案经 i18n(zh-CN/en-US)双语言下发。
 *
 * 架构位置:node 适配层 config 模块,被插件入口(apply 时实例化)与
 * config/manage.ts、console listeners 消费。
 */
import { type Dict, Schema, Time } from "@koishi-ce/koishi";
import type { PluginBundleRecord } from "../../shared/bundle.js";
import type {
	MarketSilentCustomRule,
	MarketSilentDateRule,
	MarketSilentRecentRule,
	MarketSilentRule,
	MarketSilentStatusRule,
} from "../../shared/types.js";
import type { UpdateIgnoreRule } from "../../shared/update.js";
import { InstallerConfig } from "../installer/config.js";
import { schemaEn, schemaZh } from "../locales/generated.js";
import { MarketProviderConfig } from "../market/index.js";

export type {
	MarketSilentCustomRule,
	MarketSilentDateRule,
	MarketSilentRecentRule,
	MarketSilentRule,
	MarketSilentStatusRule,
} from "../../shared/types.js";

/** koishi.yml 中本插件节点的运行时形态(Schema 校验后的 Config 类型)。 */
export interface Config {
	registry?: InstallerConfig;
	search?: MarketProviderConfig;
	marketSilentStatusRules?: MarketSilentStatusRule[];
	marketSilentDateRules?: MarketSilentDateRule[];
	marketSilentRecentRules?: MarketSilentRecentRule[];
	marketSilentCustomRules?: MarketSilentCustomRule[];
	marketSilentRules?: MarketSilentRule[];
	marketSilentFilters?: string;
	idleProbe?: boolean;
	idleProbeDelay?: number;
	idleProbeBootDelay?: number;
	idleProbeInterval?: number;
	bulkMode?: boolean;
	removeConfig?: boolean | undefined;
	updateIgnoredPackages?: string;
	updateIgnoreDuration?: number;
	updateIgnoreVersions?: number;
	updateIgnorePrerelease?: boolean;
	collapsedGroups?: Dict<boolean>;
	updateIgnored?: Dict<string | UpdateIgnoreRule>;
	bundleRecords?: Dict<PluginBundleRecord>;
}

/** 静默规则类型枚举:状态类(preview/insecure/bundle)、时间类(created/updated)、自定义。 */
const MarketSilentRuleType = Schema.union([
	Schema.const("preview").description("状态：预览版插件"),
	Schema.const("insecure").description("状态：不安全插件"),
	Schema.const("bundle").description("状态：插件包"),
	Schema.const("created-before").description("创建时间：早于指定日期"),
	Schema.const("created-after").description("创建时间：晚于指定日期"),
	Schema.const("updated-before").description("更新时间：早于指定日期"),
	Schema.const("updated-after").description("更新时间：晚于指定日期"),
	Schema.const("created-within").description("创建时间：最近 N 天内"),
	Schema.const("updated-within").description("更新时间：最近 N 天内"),
	Schema.const("custom").description("自定义高级条件"),
]);

/** marketSilentRules 的表格化 Schema:命中规则的插件直接从市场页隐藏。 */
const MarketSilentRules = Schema.array(
	Schema.object({
		type: MarketSilentRuleType.default("preview").description("规则类型"),
		value: Schema.string()
			.default("")
			.description(
				"规则值。状态类留空；日期类填写 YYYY-MM-DD，例如 2024-01-01；最近 N 天填写数字，例如 30；自定义规则填写搜索条件，例如 category:adapter。",
			),
		note: Schema.string().default("").description("备注"),
		enabled: Schema.boolean().default(true).description("是否启用"),
	}),
)
	.role("table")
	.default([])
	.description(
		"插件市场永久静默过滤。添加规则后，命中的插件会直接从市场页隐藏。",
	);

export const Config: Schema<Config> = Schema.object({
	idleProbe: Schema.boolean()
		.default(true)
		.description(
			"Run dependency and market metadata probes while Console is idle.",
		),
	idleProbeDelay: Schema.number()
		.role("time")
		.default(Time.minute * 5)
		.description(
			"How long Console must stay idle before the background probe starts.",
		),
	idleProbeBootDelay: Schema.number()
		.role("time")
		.default(Time.minute)
		.description("Minimum delay after startup before idle probing is allowed."),
	idleProbeInterval: Schema.number()
		.role("time")
		.default(Time.hour * 6)
		.description("Minimum interval between idle background probes."),
	bulkMode: Schema.boolean()
		.default(false)
		.hidden()
		.description("Batch operation mode for dependency changes."),
	removeConfig: Schema.union([
		Schema.const(undefined).description("Ask every time"),
		Schema.const(true).description("Always remove plugin config"),
		Schema.const(false).description("Never remove plugin config"),
	])
		.hidden()
		.description(
			"Whether to remove existing plugin config when uninstalling a plugin.",
		),
	updateIgnoredPackages: Schema.string()
		.role("textarea")
		.hidden()
		.description(
			"Dependency package names that should not be checked for updates.",
		),
	updateIgnoreDuration: Schema.number()
		.role("time")
		.default(0)
		.hidden()
		.description(
			"Default duration for ignoring one update. 0 means no time-based expiry.",
		),
	updateIgnoreVersions: Schema.number()
		.min(1)
		.max(20)
		.step(1)
		.default(1)
		.hidden()
		.description(
			"How many consecutive newer versions should be ignored after ignoring one update.",
		),
	updateIgnorePrerelease: Schema.boolean()
		.default(false)
		.hidden()
		.description(
			"Ignore alpha, beta, rc and other prerelease versions when checking updates.",
		),
	collapsedGroups: Schema.dict(Boolean).hidden(),
	registry: InstallerConfig,
	search: MarketProviderConfig,
	marketSilentFilters: Schema.string()
		.role("textarea")
		.hidden()
		.description("Legacy permanent silent filters."),
	marketSilentStatusRules: Schema.array(Schema.any()).hidden(),
	marketSilentDateRules: Schema.array(Schema.any()).hidden(),
	marketSilentRecentRules: Schema.array(Schema.any()).hidden(),
	marketSilentCustomRules: Schema.array(Schema.any()).hidden(),
	marketSilentRules: MarketSilentRules,
}).i18n({
	"zh-CN": schemaZh,
	"en-US": schemaEn,
});

/** market/update-config 白名单（只有这些键允许写回 loader 配置）。 */
export const configPatchKeys: Array<keyof Config> = [
	"marketSilentStatusRules",
	"marketSilentDateRules",
	"marketSilentRecentRules",
	"marketSilentCustomRules",
	"marketSilentRules",
	"marketSilentFilters",
	"idleProbe",
	"idleProbeDelay",
	"idleProbeBootDelay",
	"idleProbeInterval",
	"bulkMode",
	"removeConfig",
	"updateIgnoredPackages",
	"updateIgnoreDuration",
	"updateIgnoreVersions",
	"updateIgnorePrerelease",
];

/** 变更后需要 reload 插件的键。 */
export const configReloadKeys = new Set<keyof Config>([
	"idleProbe",
	"idleProbeDelay",
	"idleProbeBootDelay",
	"idleProbeInterval",
]);

/** market/update-config 的静默规则归一化。 */
export function normalizeMarketSilentRules(value: unknown): MarketSilentRule[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(rule): rule is MarketSilentRule => !!rule && typeof rule === "object",
		)
		.map((rule) => {
			const normalized: MarketSilentRule = {
				value: normalizeMarketSilentRuleValue(rule),
				enabled: rule.enabled ?? true,
			};
			if (rule.type !== undefined) normalized.type = rule.type;
			if (rule.note !== undefined) normalized.note = rule.note;
			return normalized;
		});
}

/**
 * 从旧版规则形态(date/days/query 独立字段)提取 value:新形态直接用
 * rule.value,旧形态按字段顺序回退,保证升级后规则不丢。
 */
function normalizeMarketSilentRuleValue(rule: MarketSilentRule) {
	const value = String(rule.value ?? "").trim();
	if (value) return value;
	if (rule.date) return String(rule.date).trim();
	if (rule.days != null) return String(rule.days).trim();
	if (rule.query) return String(rule.query).trim();
	return "";
}
