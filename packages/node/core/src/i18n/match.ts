import type { I18n } from "./index";

export interface CompareOptions {
	minSimilarity?: number;
}

type GroupNames<
	P extends string,
	K extends string = never,
> = P extends `${string}(${infer R})${infer S}` ? GroupNames<S, K | R> : K;

export type MatchResult<P extends string = never> = Record<
	GroupNames<P>,
	string
>;

export function createMatch<P extends string>(
	pattern: P,
): (string: string) => undefined | MatchResult<P> {
	const groups: string[] = [];
	const source = pattern.replace(/\(([^)]+)\)/g, (_, name) => {
		groups.push(name);
		return "(.+)";
	});
	const regexp = new RegExp(`^${source}$`);
	return (string: string) => {
		const capture = regexp.exec(string);
		if (!capture) return;
		const data: any = {};
		for (const [i, name] of groups.entries()) {
			data[name] = capture[i + 1];
		}
		return data;
	};
}

export function findMatches<P extends string>(
	i18n: I18n,
	pattern: P,
	actual: string,
	options: CompareOptions = {},
): I18n.FindResult<P>[] {
	if (!actual) return [];
	const match = createMatch(pattern);
	const results: I18n.FindResult<P>[] = [];
	for (const locale in i18n._data) {
		for (const path in i18n._data[locale]) {
			const data = match(path);
			if (!data) continue;
			const expect = i18n._data[locale][path];
			if (typeof expect !== "string") continue;
			const similarity = i18n.compare(expect, actual, options);
			if (!similarity) continue;
			results.push({ locale, data, similarity });
		}
	}
	return results;
}
