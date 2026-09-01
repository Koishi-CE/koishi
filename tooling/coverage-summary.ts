// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 解析根目录 lcov.info，输出按行覆盖率升序的文件清单与总覆盖率。
 *
 * 用法：bun test --coverage --coverage-reporter=lcov && bun tooling/coverage-summary.ts [过滤词]
 * 补测时先跑最低的文件，参数可传包路径片段做过滤（如 `bun tooling/coverage-summary.ts core`）。
 */
import { readFileSync } from "node:fs";

const filter = process.argv[2];
interface Entry {
	file: string;
	total: number;
	hit: number;
}

const entries: Entry[] = [];
let cur: Partial<Entry> | null = null;
for (const line of readFileSync("coverage/lcov.info", "utf8").split("\n")) {
	if (line.startsWith("SF:")) {
		cur = { file: line.slice(3).trim().replace(/\\/g, "/") };
	} else if (line.startsWith("LF:")) {
		if (cur) cur.total = Number(line.slice(3));
	} else if (line.startsWith("LH:")) {
		if (cur) cur.hit = Number(line.slice(3));
		if (
			cur &&
			cur.total !== undefined &&
			cur.hit !== undefined &&
			(!filter || cur.file.includes(filter))
		) {
			entries.push(cur as Entry);
		}
		cur = null;
	}
}

entries.sort((a, b) => a.hit / a.total - b.hit / b.total);
const sum = entries.reduce(
	(acc, x) => ({ total: acc.total + x.total, hit: acc.hit + x.hit }),
	{ total: 0, hit: 0 },
);
for (const { file, total, hit } of entries) {
	const pct = ((hit / total) * 100).toFixed(1).padStart(6);
	console.log(
		`${pct}%  ${hit}/${total}  ${file.replace(/^.*?(packages|plugins|apps|tooling)\//, "$1/")}`,
	);
}
console.log(
	`\n合计：${((sum.hit / sum.total) * 100).toFixed(2)}% 行覆盖（${sum.hit}/${sum.total}，${entries.length} 个文件${filter ? `，过滤 "${filter}"` : ""}）`,
);
