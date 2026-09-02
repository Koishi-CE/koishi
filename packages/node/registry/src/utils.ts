// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 插件市场扫描器的工具集：Ensure 系列运行时类型守卫（清洗来自外部
 * registry / 任意 package.json 的不可信字段）与 conclude()（把
 * package.json 的 koishi 字段与约定关键词汇总成结构化 Manifest）。
 */
import type { Awaitable, Dict } from "cosmokit";
import type { Manifest, PackageJson } from "./types.ts";

// 与 `Ensure` 常量同名：接口占据类型空间，常量占据值空间，二者合并声明
/**
 * 类型守卫函数签名：传入任意值与可选回退值，类型不符时返回 undefined
 * 或回退值（两个重载）。
 */
export interface Ensure<T> {
	(value: unknown): T | undefined;
	(value: unknown, fallback: T): T;
}

// 实现重载签名的惯用写法：无回退时实际返回 undefined，
// 该情形由 Ensure 的第一个重载（T | undefined）如实表达，
// 故回退分支断言为 T 不影响对外类型的安全。
/** 清洗为数组：仅当输入确为 string[] 时返回，否则取回退值 */
const ensureArray: Ensure<string[]> = (
	value: unknown,
	fallback?: string[],
): string[] => {
	if (!Array.isArray(value)) return fallback as string[];
	return value.filter((x): x is string => typeof x === "string");
};

/** 清洗为字符串字典：丢弃值不是 string 的键，类型不符时取回退值 */
const ensureDict: Ensure<Dict<string>> = (
	value: unknown,
	fallback?: Dict<string>,
): Dict<string> => {
	if (typeof value !== "object" || value === null)
		return fallback as Dict<string>;
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
	(value: unknown, fallback?: T): T => {
		if (typeof value !== type) return fallback as T;
		// typeof 已按 type 名校验通过，断言为 T 是安全的
		return value as T;
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

/**
 * 带并发上限的保序 map（p-map 的最小等价实现，用于替换 npm 依赖）。
 *
 * 逐个取出输入元素并以不超过 concurrency 的并发调用 mapper，返回值按下标
 * 写入 pending 后统一 Promise.all，保证返回数组与输入同序；任一 mapper
 * 抛错会让整体 reject（等价于 p-map 默认 stopOnError: true 的行为，其余
 * 已启动的任务继续执行但不影响已 reject 的结果）。并发实现是 worker 池：
 * 每次取一个下标执行，全部取完即收束，不依赖外部计数器或信号量。
 *
 * 返回值先存 Promise 再统一兑现（而非在 worker 内 await 后直接写回），
 * 是因为 Awaitable<R> 对未约束泛型 R 在 await 展开后仍保留条件类型，
 * 直接赋回 R[] 无法通过类型检查；经 Promise.all 收口则类型自然化简。
 */
export async function mapLimit<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Awaitable<R>,
): Promise<R[]> {
	const pending = new Array<Promise<R>>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			const item = items[index];
			if (item === undefined) break;
			pending[index] = Promise.resolve(mapper(item, index));
		}
	};
	// 并发数上限：任务数少于并发时按任务数起 worker
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, worker),
	);
	return Promise.all(pending);
}
