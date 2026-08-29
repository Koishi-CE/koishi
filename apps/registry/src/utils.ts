/**
 * 插件市场扫描器的工具集：Ensure 系列运行时类型守卫（清洗来自外部
 * registry / 任意 package.json 的不可信字段）与 conclude()（把
 * package.json 的 koishi 字段与约定关键词汇总成结构化 Manifest）。
 */
import type { Dict } from "cosmokit";
import type { Manifest, PackageJson } from "./types";

// 与 `Ensure` 常量同名：接口占据类型空间，常量占据值空间，二者合并声明
/**
 * 类型守卫函数签名：传入任意值与可选回退值，类型不符时返回 undefined
 * 或回退值（两个重载）。
 */
export interface Ensure<T> {
	(value: any): T | undefined;
	(value: any, fallback: T): T;
}

/** 清洗为数组：仅当输入确为 string[] 时返回，否则取回退值 */
const ensureArray: Ensure<string[]> = (value: any, fallback?: any) => {
	if (!Array.isArray(value)) return fallback;
	return value.filter((x) => typeof x === "string");
};

/** 清洗为字符串字典：丢弃值不是 string 的键，类型不符时取回退值 */
const ensureDict: Ensure<Dict<string>> = (value: any, fallback?: any) => {
	if (typeof value !== "object" || value === null) return fallback;
	return Object.entries(value).reduce<Dict<string>>((dict, [key, value]) => {
		if (typeof value === "string") dict[key] = value;
		return dict;
	}, {});
};

// https://github.com/microsoft/TypeScript/issues/15713#issuecomment-499474386
// （按 typeof 动态校验原始类型的工厂写法参考自该 issue）
/** 原始类型守卫工厂：按传入的 typeof 结果名校验 boolean / number / string */
const primitive =
	<T>(type: string): Ensure<T> =>
	(value: any, fallback?: T) => {
		if (typeof value !== type) return fallback;
		return value;
	};

/** Ensure 系列守卫的统一出口，消费方经 Ensure.array(...) 等调用 */
export const Ensure = {
	array: ensureArray,
	dict: ensureDict,
	boolean: primitive<boolean>("boolean"),
	number: primitive<number>("number"),
	string: primitive<string>("string"),
};

// exactOptionalPropertyTypes：仅在值存在时写入可选属性
function assignIfDefined<T, K extends keyof T>(
	target: T,
	key: K,
	value: T[K] | undefined,
) {
	if (value !== undefined) target[key] = value;
}

/**
 * 从 package.json 提取 Koishi 插件清单（Manifest）。
 *
 * - description 优先取 koishi.description（支持多语言字典），回退到顶层
 *   description，并截断到 1024 字符；
 * - koishi 字段里的 hidden / preview / insecure / browser / category /
 *   public / service / locales 经 Ensure 清洗后写入（未提供的不落键）；
 * - 消费 keywords 里的约定关键词（market:hidden、required:*、optional:*、
 *   impl:*、locale:*）折算进对应清单字段，用过的关键词从 keywords 剔除。
 */
export function conclude(meta: PackageJson) {
	const koishi = meta.koishi;
	const manifest: Manifest = {
		description:
			Ensure.dict(koishi?.description) || Ensure.string(meta.description, ""),
		locales: Ensure.array(koishi?.locales, []),
		service: {
			required: Ensure.array(koishi?.service?.required, []),
			optional: Ensure.array(koishi?.service?.optional, []),
			implements: Ensure.array(koishi?.service?.implements, []),
		},
	};
	assignIfDefined(manifest, "hidden", Ensure.boolean(koishi?.hidden));
	assignIfDefined(manifest, "preview", Ensure.boolean(koishi?.preview));
	assignIfDefined(manifest, "insecure", Ensure.boolean(koishi?.insecure));
	assignIfDefined(manifest, "browser", Ensure.boolean(koishi?.browser));
	assignIfDefined(manifest, "category", Ensure.string(koishi?.category));
	assignIfDefined(manifest, "public", Ensure.array(koishi?.public));

	if (typeof manifest.description === "string") {
		manifest.description = manifest.description.slice(0, 1024);
	} else if (manifest.description) {
		const dict = manifest.description;
		for (const key in dict) {
			const text = dict[key];
			if (text !== undefined) dict[key] = text.slice(0, 1024);
		}
	}

	meta.keywords = Ensure.array(meta.keywords, []).filter((keyword) => {
		if (!keyword.includes(":")) return true;
		if (keyword === "market:hidden") {
			manifest.hidden = true;
		} else if (keyword.startsWith("required:")) {
			manifest.service.required.push(keyword.slice(9));
		} else if (keyword.startsWith("optional:")) {
			manifest.service.optional.push(keyword.slice(9));
		} else if (keyword.startsWith("impl:")) {
			manifest.service.implements.push(keyword.slice(5));
		} else if (keyword.startsWith("locale:")) {
			manifest.locales.push(keyword.slice(7));
		}
		// 含 ":" 的关键词在被消费后一律从 keywords 中剔除
		return false;
	});

	return manifest;
}
