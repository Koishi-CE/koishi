// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 全仓词典键对齐检查（零依赖，bun 直跑）。
 *
 * 用法：bun tooling/check-locales.ts
 *
 * 以每个词典目录的 zh-CN.yml 为基准，检查三件事：
 *   1. 键对齐：目录内其他语种文件的键路径集合与基准一致
 *      （缺失 / 多余键均报告；数组的下标也参与键路径，保证
 *      Schemastery 列表形态词典的同构性）；
 *   2. 语种齐全：除豁免目录外，词典目录应覆盖全部 7 个语种；
 *   3. 假翻译：非中文语种的叶值若仍为简体中文（上游遗留的
 *      中文占位），视为假翻译报告。
 * 发现任何问题时退出码置 1。豁免目录见 EXEMPT_DIRS（上游即
 * 如此，维持对齐不强行补齐，详见 docs/guides/development.md）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** 仓库根目录（本脚本位于 tooling/ 下）。 */
const ROOT = resolve(import.meta.dirname, "..");

/** 全仓标准的 7 个语种（zh-CN 为基准语种）。 */
const LOCALES = [
	"zh-CN",
	"zh-TW",
	"en-US",
	"ja-JP",
	"fr-FR",
	"de-DE",
	"ru-RU",
] as const;

/**
 * 完全跳过检查的路径（相对仓库根，正斜杠分隔）：
 * - market：上游原版再分发（硬约束 7，词典为 message./schema. 双前缀
 *   形态，且不随本仓改动，检查无意义）；
 * - plugins/webui/locales：plugin-locales 包目录（目录名恰好为
 *   locales，但词条内容来自用户数据目录，包内无词典文件）。
 */
const SKIP_DIRS = new Set([
	"plugins/webui/market/src/node/locales",
	"plugins/webui/locales",
]);

/**
 * 豁免「7 语种齐全」检查的词典目录（相对仓库根，正斜杠分隔）：
 * - sandbox / commands / rate-limit：上游即仅 zh-CN，维持对齐；
 * - sqlite：CE 自增强词典，中英双语。
 * 豁免只针对语种数量，键对齐与假翻译检查仍然生效。
 */
const EXEMPT_DIRS = new Set([
	"plugins/webui/sandbox/locales",
	"plugins/webui/commands/locales",
	"plugins/common/rate-limit/locales",
	"plugins/infra/sqlite/locales",
]);

/** 递归收集仓库内全部名为 locales 的目录（跳过 node_modules / 产物目录）。 */
function collectLocaleDirs(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		if (
			entry.name === "node_modules" ||
			entry.name === "lib" ||
			entry.name === "dist" ||
			entry.name === ".git"
		) {
			continue;
		}
		const full = join(dir, entry.name);
		if (entry.name === "locales") {
			out.push(full);
		} else {
			out.push(...collectLocaleDirs(full));
		}
	}
	return out;
}

/**
 * 递归提取词典对象的全部键路径。
 * - 普通对象的键拼入路径后继续下钻；
 * - 数组以下标拼入路径（保证列表形态词典的同构检查）；
 * - 其余值视为叶子。
 */
function extractKeys(
	node: unknown,
	prefix: string,
	out: Set<string>,
) {
	if (Array.isArray(node)) {
		node.forEach((item, index) => {
			extractKeys(item, `${prefix}.${index}`, out);
		});
		return;
	}
	if (node && typeof node === "object") {
		for (const [key, value] of Object.entries(
			node as Record<string, unknown>,
		)) {
			extractKeys(
				value,
				prefix ? `${prefix}.${key}` : key,
				out,
			);
		}
		return;
	}
	// 叶节点：路径本身即键（把末级键名也计入，空对象除外）
	if (prefix) out.add(prefix);
}

/** 判断文本是否包含汉字（用于非中文语种的假翻译检测）。 */
function containsChinese(text: string): boolean {
	return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * 参与假翻译检测的语种：仅拉丁 / 西里尔书写的语种。
 * ja-JP 正常译文大量使用汉字、zh-TW 与简体同源，均无法按
 * 字形区分真伪翻译，故不参与检测。
 */
const FAKE_CHECK_LOCALES = new Set([
	"en-US",
	"fr-FR",
	"de-DE",
	"ru-RU",
]);

/** 收集全部报警，最后统一输出。 */
const problems: string[] = [];

// ---------------------------------------------------------------- main

const dirs = collectLocaleDirs(ROOT).sort();
if (!dirs.length) {
	console.error(
		"未找到任何 locales 目录，检查脚本可能需要调整",
	);
	process.exit(1);
}

for (const dir of dirs) {
	const relDir = relative(ROOT, dir).replaceAll("\\", "/");
	// 完全跳过名单内的路径（上游再分发 / 非词典目录）
	if (SKIP_DIRS.has(relDir)) continue;
	const files = readdirSync(dir).filter((name) =>
		name.endsWith(".yml"),
	);
	const present = new Set(
		files.map((name) => name.replace(/\.yml$/, "")),
	);

	// 基准文件缺失时只能跳过该目录（并提示）
	if (!present.has("zh-CN")) {
		problems.push(`${relDir}：缺少基准文件 zh-CN.yml`);
		continue;
	}

	// 检查 1：语种齐全（豁免目录仅要求 zh-CN 存在）
	if (!EXEMPT_DIRS.has(relDir)) {
		for (const locale of LOCALES) {
			if (!present.has(locale)) {
				problems.push(`${relDir}：缺少 ${locale}.yml`);
			}
		}
	}

	// 解析基准键集
	const baseKeys = new Set<string>();
	try {
		const base = Bun.YAML.parse(
			readFileSync(join(dir, "zh-CN.yml"), "utf8"),
		);
		extractKeys(base, "", baseKeys);
	} catch (error) {
		problems.push(
			`${relDir}/zh-CN.yml：YAML 解析失败（${error}）`,
		);
		continue;
	}

	// 逐语种检查键对齐与假翻译
	for (const locale of present) {
		if (locale === "zh-CN") continue;
		const file = join(dir, `${locale}.yml`);
		const relFile = `${relDir}/${locale}.yml`;
		let parsed: unknown;
		try {
			parsed = Bun.YAML.parse(readFileSync(file, "utf8"));
		} catch (error) {
			problems.push(
				`${relFile}：YAML 解析失败（${error}）`,
			);
			continue;
		}

		const keys = new Set<string>();
		extractKeys(parsed, "", keys);

		// 键对齐（相对基准报告缺失 / 多余）
		for (const key of baseKeys) {
			if (!keys.has(key)) {
				problems.push(`${relFile}：缺少键 ${key}`);
			}
		}
		for (const key of keys) {
			if (!baseKeys.has(key)) {
				problems.push(`${relFile}：多余键 ${key}`);
			}
		}

		// 假翻译：拉丁 / 西里尔语种的叶值仍含汉字即视为占位
		if (!FAKE_CHECK_LOCALES.has(locale)) continue;
		const walk = (node: unknown, path: string) => {
			if (Array.isArray(node)) {
				node.forEach((item, index) =>
					walk(item, `${path}.${index}`),
				);
			} else if (node && typeof node === "object") {
				for (const [key, value] of Object.entries(
					node as Record<string, unknown>,
				)) {
					walk(value, path ? `${path}.${key}` : key);
				}
			} else if (
				typeof node === "string" &&
				containsChinese(node)
			) {
				problems.push(
					`${relFile}：键 ${path} 疑似假翻译（值仍为中文）`,
				);
			}
		};
		walk(parsed, "");
	}
}

// ---------------------------------------------------------------- 汇总输出

if (problems.length) {
	console.error(`词典检查发现 ${problems.length} 个问题：`);
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	process.exit(1);
} else {
	console.log(
		`词典检查通过：${dirs.length} 个词典目录，键对齐 / 语种齐全 / 假翻译均无问题`,
	);
}
