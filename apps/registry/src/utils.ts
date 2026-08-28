import type { Dict } from "cosmokit";
import type { Manifest, PackageJson } from "./types";

// 与 `Ensure` 常量同名：接口占据类型空间，常量占据值空间，二者合并声明
export interface Ensure<T> {
	(value: any): T | undefined;
	(value: any, fallback: T): T;
}

const ensureArray: Ensure<string[]> = (value: any, fallback?: any) => {
	if (!Array.isArray(value)) return fallback;
	return value.filter((x) => typeof x === "string");
};

const ensureDict: Ensure<Dict<string>> = (value: any, fallback?: any) => {
	if (typeof value !== "object" || value === null) return fallback;
	return Object.entries(value).reduce<Dict<string>>((dict, [key, value]) => {
		if (typeof value === "string") dict[key] = value;
		return dict;
	}, {});
};

// https://github.com/microsoft/TypeScript/issues/15713#issuecomment-499474386
const primitive =
	<T>(type: string): Ensure<T> =>
	(value: any, fallback?: T) => {
		if (typeof value !== type) return fallback;
		return value;
	};

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
