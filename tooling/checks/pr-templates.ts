// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * PR 模板对账门禁（bun 直跑，零依赖）。
 *
 * 用法：bun tooling/checks/pr-templates.ts
 *
 * 2026-09-25 起本仓 PR 模板按改动领域拆分，全部落在
 * .github/PULL_REQUEST_TEMPLATE/ 下，由同目录 config.yml 的下拉清单
 * （GitHub 约定的 name / description / body 三字段）指向。该目录的
 * 漂移不会让 CI 变红，只会让开 PR 的人选到空模板或 404 的
 * 「File not found」——因此把三个易漂移点固化为对账：
 *
 *   1. 清单指向的 body 文件必须存在（改名后忘改 config 即命中）；
 *   2. 目录内的别的 .md 不得是清单外的孤儿（新增模板忘登记即命中）；
 *   3. 清单字段形态（必填、类型、name 不重复、body 不越出本目录）。
 *
 * 发现任何问题时退出码置 1。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** 仓库根目录（本脚本位于 tooling/checks/ 下）。 */
const ROOT = resolve(import.meta.dirname, "../..");

/** PR 模板目录与选择器配置。 */
const DIR = join(ROOT, ".github", "PULL_REQUEST_TEMPLATE");
const CONFIG = join(DIR, "config.yml");

/** 允许的字段集合（GitHub 的 PR 模板清单只认这三个）。 */
const ALLOWED_KEYS = new Set([
	"name",
	"description",
	"body",
]);

/** 目录内不参与对账的说明文件（面向贡献者的导航页，非模板本体）。 */
const NON_TEMPLATE = new Set(["README.md"]);

const problems: string[] = [];

/** 记录一条问题，路径取相对仓库根的形式。 */
function report(message: string): void {
	problems.push(message);
}

/** 校验清单里的一条模板条目，返回其声明的 body 文件名。 */
function checkEntry(
	entry: unknown,
	index: number,
): string | null {
	const where = `config.yml 第 ${index + 1} 条模板`;
	if (typeof entry !== "object" || entry === null) {
		report(`${where}不是对象。`);
		return null;
	}
	const record = entry as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!ALLOWED_KEYS.has(key))
			report(
				`${where}含未知字段 "${key}"（只认 name / description / body）。`,
			);
	}
	for (const key of ALLOWED_KEYS) {
		const value = record[key];
		if (typeof value !== "string" || value.trim() === "") {
			report(`${where}缺少非空的 "${key}" 字段。`);
		}
	}
	const body = record.body;
	if (typeof body !== "string" || body.trim() === "")
		return null;
	if (
		body.includes("/") ||
		body.includes("\\") ||
		body.includes("..")
	) {
		report(
			`${where}的 body "${body}" 不是本目录下的文件名。`,
		);
		return null;
	}
	if (!body.endsWith(".md")) {
		report(`${where}的 body "${body}" 不是 .md 文件。`);
		return null;
	}
	return body;
}

// ---- 主流程 ----

let listedBodies: string[] = [];
const names = new Set<string>();

if (!(await Bun.file(CONFIG).exists())) {
	report(
		"缺少 PR 模板清单 .github/PULL_REQUEST_TEMPLATE/config.yml。",
	);
} else {
	let config: unknown;
	try {
		config = Bun.YAML.parse(readFileSync(CONFIG, "utf8"));
	} catch (error) {
		report(`config.yml 解析失败：${String(error)}`);
	}
	if (config !== undefined) {
		const templates =
			typeof config === "object" && config !== null
				? (config as Record<string, unknown>).templates
				: undefined;
		if (
			!Array.isArray(templates) ||
			templates.length === 0
		) {
			report("config.yml 的 templates 必须是非空数组。");
		} else {
			listedBodies = templates
				.map((entry, index) => checkEntry(entry, index))
				.filter((body): body is string => body !== null);
			for (const entry of templates) {
				const name =
					typeof entry === "object" && entry !== null
						? (entry as Record<string, unknown>).name
						: undefined;
				if (typeof name !== "string" || name === "")
					continue;
				if (names.has(name))
					report(`模板 name "${name}" 重复。`);
				names.add(name);
			}
		}
	}
}

// 清单 → 文件：body 必须存在。
for (const body of listedBodies) {
	if (!(await Bun.file(join(DIR, body)).exists())) {
		report(
			`清单指向的模板文件不存在：.github/PULL_REQUEST_TEMPLATE/${body}`,
		);
	}
}

// 文件 → 清单：目录内的 .md 不得是孤儿。
for (const file of readdirSync(DIR)) {
	if (!file.endsWith(".md") || NON_TEMPLATE.has(file))
		continue;
	if (!listedBodies.includes(file)) {
		report(
			`模板文件未登记进 config.yml 的 templates：.github/PULL_REQUEST_TEMPLATE/${file}`,
		);
	}
}

// ---- 输出 ----

if (problems.length === 0) {
	console.log(
		`PR 模板对账通过（config.yml 登记 ${listedBodies.length} 个模板，目录 ${relative(ROOT, DIR).replaceAll("\\", "/")} 无孤儿文件）。`,
	);
} else {
	for (const problem of problems)
		console.error(`- ${problem}`);
	console.error(
		`PR 模板对账失败：${problems.length} 处问题。`,
	);
	process.exitCode = 1;
}
