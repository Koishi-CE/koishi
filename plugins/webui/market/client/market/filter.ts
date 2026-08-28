/**
 * @file 市场查询词的校验与过滤(market 域)。
 *
 * - validate:单条查询词对单个条目的判定(is:/not: 状态、created/updated 日期
 *   比较、within:N 时间窗、impl/locale/using/category/email 元数据、纯文本相似度);
 * - getVisible/getFiltered/getSilentFiltered:隐藏条目放行与批量过滤/排除;
 * - validateWord/hasFilter/parseSilentFilters:查询词合法性/有效过滤判定/静音词解析。
 */

import type { SearchObject, User } from "@koishi-ce/registry";
import type { MarketConfig } from "./context";
import {
	getSearchIndex,
	getSimilarityByIndex,
	normalizeFilterWords,
	normalizePackageName,
	type MarketSearchIndex,
} from "./similarity";
import { getUsers } from "./users";

interface ValidateConfig extends MarketConfig {
	users?: User[];
	index?: MarketSearchIndex;
}

export function getVisible(market: SearchObject[], words: string[]) {
	return market?.slice().filter((data) => {
		return (
			(!data.manifest?.hidden || words.includes("show:hidden")) &&
			(!(data as SearchObject & { deprecated?: unknown }).deprecated ||
				words.includes("show:deprecated"))
		);
	});
}

export function getFiltered(
	market: SearchObject[],
	words: string[],
	config?: MarketConfig,
) {
	const filters = normalizeFilterWords(words);
	if (!filters.length) return market;
	return market.filter((data) => {
		const index = getSearchIndex(data);
		return filters.every((word) => {
			return validate(data, word, { ...config, index, users: index.users });
		});
	});
}

export function getSilentFiltered(
	market: SearchObject[],
	words: string[],
	config?: MarketConfig,
) {
	const filters = normalizeFilterWords(words);
	if (!filters.length) return market;
	return market.filter((data) => {
		const index = getSearchIndex(data);
		return !filters.some((word) => {
			return validate(data, word, { ...config, index, users: index.users });
		});
	});
}

export function parseSilentFilters(value?: string | string[]) {
	const source = Array.isArray(value) ? value : (value ?? "").split(/\n+/g);
	return normalizeFilterWords(
		source.flatMap((item) => String(item).split(/[\s,，;；]+/g)),
	);
}

const modifiers = ["show:", "sort:", "limit:"];

export function hasFilter(words: string[]) {
	return (
		words.filter((w) => w && modifiers.every((prefix) => !w.startsWith(prefix)))
			.length > 0
	);
}

const operators = [
	"is",
	"not",
	"created",
	"updated",
	"impl",
	"locale",
	"using",
	"category",
	"email",
	"show",
	"sort",
	"limit",
];

export function validateWord(word: string) {
	if (!word.includes(":")) return true;
	const [key] = word.split(":", 1);
	return operators.includes(key);
}

/** 日期/时间窗词的分派规则(前缀须保持原判定顺序:within 与 <=/>= 在 < / > 之前)。 */
interface DateFilterRule {
	prefix: string;
	field: "created" | "updated";
	op: "within" | "<" | "<=" | ">" | ">=";
}

const dateFilterRules: DateFilterRule[] = [
	{ prefix: "updated:within:", field: "updated", op: "within" },
	{ prefix: "created:within:", field: "created", op: "within" },
	{ prefix: "updated:<=", field: "updated", op: "<=" },
	{ prefix: "updated:>=", field: "updated", op: ">=" },
	{ prefix: "updated:<", field: "updated", op: "<" },
	{ prefix: "updated:>", field: "updated", op: ">" },
	{ prefix: "created:<=", field: "created", op: "<=" },
	{ prefix: "created:>=", field: "created", op: ">=" },
	{ prefix: "created:<", field: "created", op: "<" },
	{ prefix: "created:>", field: "created", op: ">" },
];

/** 判定日期/时间窗查询词;非日期词返回 undefined 交回主流程。 */
function validateDateFilter(
	index: MarketSearchIndex,
	word: string,
): boolean | undefined {
	const rule = dateFilterRules.find((rule) => word.startsWith(rule.prefix));
	if (!rule) return undefined;
	const query = word.slice(rule.prefix.length);
	const isCreated = rule.field === "created";
	if (rule.op === "within") {
		return withinDays(
			isCreated ? index.createdTimestamp : index.updatedTimestamp,
			query,
		);
	}
	return compareDate(
		isCreated ? index.createdAt : index.updatedAt,
		isCreated ? index.createdTimestamp : index.updatedTimestamp,
		rule.op,
		query,
	);
}

/** 解析 is:/not: 的状态键;无 manifest 时仅 installed/bundle,未知键返回 undefined。 */
function resolveStatusFlag(
	data: SearchObject,
	index: MarketSearchIndex,
	config: ValidateConfig,
	key: string,
	manifest: SearchObject["manifest"],
): boolean | undefined {
	if (key === "installed") return !!config.installed?.(data);
	if (key === "bundle") return index.bundle;
	if (!manifest) return undefined;
	if (key === "verified") return data.verified;
	if (key === "insecure") return data.insecure;
	if (key === "portable") return data.portable;
	if (key === "preview") return !!manifest.preview;
	return undefined;
}

/** is:/not: 状态词判定:未识别的状态 is 一律否决、not 一律放行。 */
function validateStatusWord(
	data: SearchObject,
	index: MarketSearchIndex,
	config: ValidateConfig,
	word: string,
) {
	const negate = word.startsWith("not:");
	const flag = resolveStatusFlag(
		data,
		index,
		config,
		word.slice(negate ? 4 : 3),
		data.manifest,
	);
	if (flag === undefined) return negate;
	return negate ? !flag : flag;
}

/** 判定 impl/locale/using/category/email 元数据词;非元数据词返回 undefined。 */
function validateManifestWord(
	data: SearchObject,
	index: MarketSearchIndex,
	config: ValidateConfig,
	word: string,
	manifest: NonNullable<SearchObject["manifest"]>,
): boolean | undefined {
	const { locales, service } = manifest;
	if (word.startsWith("impl:")) {
		return service.implements.includes(word.slice(5));
	}
	if (word.startsWith("locale:")) {
		return locales.includes(word.slice(7));
	}
	if (word.startsWith("using:")) {
		const name = word.slice(6);
		return service.required.includes(name) || service.optional.includes(name);
	}
	if (word.startsWith("category:")) {
		return index.category === word.slice(9);
	}
	if (word.startsWith("email:")) {
		const users = config.users ?? getUsers(data);
		const target = word.slice(6);
		return users.some(({ email }) => email?.toLowerCase() === target);
	}
	return undefined;
}

export function validate(
	data: SearchObject,
	word: string,
	config: ValidateConfig = {},
) {
	const index = config.index ?? getSearchIndex(data);
	const dateResult = validateDateFilter(index, word);
	if (dateResult !== undefined) return dateResult;
	if (word.startsWith("is:") || word.startsWith("not:")) {
		return validateStatusWord(data, index, config, word);
	}
	if (data.manifest) {
		const metaResult = validateManifestWord(
			data,
			index,
			config,
			word,
			data.manifest,
		);
		if (metaResult !== undefined) return metaResult;
	}
	if (word.includes(":")) return true;
	return getSimilarityByIndex(index, normalizePackageName(word)) > 0;
}

function parseQueryDate(value: string, endOfDay = false) {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
		return Date.parse(value + suffix);
	}
	return Date.parse(value);
}

function compareDate(
	value: string,
	timestamp: number,
	operator: "<" | "<=" | ">" | ">=",
	query: string,
) {
	const left = timestamp;
	const right = parseQueryDate(query, operator === "<=" || operator === ">");
	if (Number.isFinite(left) && Number.isFinite(right)) {
		if (operator === "<") return left < right;
		if (operator === "<=") return left <= right;
		if (operator === ">") return left > right;
		return left >= right;
	}
	if (operator === "<") return value < query;
	if (operator === "<=") return value <= query;
	if (operator === ">") return value > query;
	return value >= query;
}

function withinDays(timestamp: number, query: string) {
	if (!/^\d{1,4}$/.test(query)) return true;
	if (!Number.isFinite(timestamp)) return false;
	const days = Number(query);
	return timestamp >= Date.now() - days * 86400000;
}
