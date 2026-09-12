// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * setup 的参数与问询：命令行 flags 解析、包名规范化（自动补
 * koishi-plugin- 前缀）、GitHub 所有者的兄弟项目众数探测、git 全局
 * 配置读取与交互式问询（--name 给定时整体转非交互）。
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { cwd } from "../index.ts";

/** 问询答案（setup 各层的公共输入） */
export interface Answers {
	/** npm 包名（规范形如 koishi-plugin-foo 或 @scope/koishi-plugin-foo） */
	name: string;
	/** 目录名（去前缀，如 foo），同时是插件短名 */
	dirname: string;
	/** 一句话描述（可为空） */
	desc: string;
	/** GitHub 所有者（空 → 不写 homepage/repository 字段） */
	owner: string;
}

/** 解析 --key=value 形式的命令行参数。 */
export function parseFlags(
	argv: readonly string[],
): Record<string, string> {
	const flags: Record<string, string> = {};
	for (const arg of argv) {
		const match = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
		if (
			match?.[1] !== undefined &&
			match?.[2] !== undefined
		) {
			flags[match[1]] = match[2];
		}
	}
	return flags;
}

/**
 * 规范化包名：小写化、下划线转连字符；无论是否带 @scope，尾段缺
 * koishi-plugin- 前缀时自动补齐。
 */
export function normalizeName(raw: string): string | null {
	let name = raw.trim().toLowerCase().replace(/_/g, "-");
	if (name.startsWith("@")) {
		// @scope/koishi-plugin-x：scope 段校验 + 尾段自动补前缀
		const slash = name.indexOf("/");
		if (
			slash < 0 ||
			!/^@[a-z0-9-]+$/.test(name.slice(0, slash))
		) {
			return null;
		}
		const segment = name.slice(slash + 1);
		const prefixed = segment.startsWith("koishi-plugin-")
			? segment
			: `koishi-plugin-${segment}`;
		return isValidPluginSegment(prefixed)
			? `${name.slice(0, slash)}/${prefixed}`
			: null;
	}
	if (!name.startsWith("koishi-plugin-")) {
		name = `koishi-plugin-${name}`;
	}
	return isValidPluginSegment(name) ? name : null;
}

/** 校验包名尾段是否为合法 npm 名且带 koishi-plugin- 前缀。 */
function isValidPluginSegment(name: string): boolean {
	if (!name.startsWith("koishi-plugin-")) {
		return false;
	}
	const body = name.slice("koishi-plugin-".length);
	return (
		body.length > 0 &&
		/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(body)
	);
}

/** 由包名推导目录名（也是插件短名）：@scope/koishi-plugin-x → x。 */
export function deriveDirname(name: string): string {
	const pkg = name.includes("/")
		? (name.split("/")[1] ?? name)
		: name;
	return pkg.slice("koishi-plugin-".length);
}

/**
 * 从兄弟项目的 repository.url 探测 GitHub 所有者（取众数；宿主工作区内
 * 项目同属一个账号，新项目跟随即可，省一次问询输入）。
 */
function detectOwner(): string {
	const externalDir = join(cwd, "external");
	const counts = new Map<string, number>();
	try {
		for (const entry of readdirSync(externalDir, {
			withFileTypes: true,
		})) {
			if (!entry.isDirectory()) {
				continue;
			}
			const manifestPath = join(
				externalDir,
				entry.name,
				"package.json",
			);
			if (!existsSync(manifestPath)) {
				continue;
			}
			const url = (
				JSON.parse(readFileSync(manifestPath, "utf8")) as {
					repository?: { url?: string };
				}
			).repository?.url;
			const match =
				typeof url === "string"
					? /github\.com[:/]([A-Za-z0-9_-]+)\//.exec(url)
					: null;
			if (match?.[1] !== undefined) {
				counts.set(
					match[1],
					(counts.get(match[1]) ?? 0) + 1,
				);
			}
		}
	} catch {
		return "";
	}
	let best = "";
	let bestCount = 0;
	for (const [owner, count] of counts) {
		if (count > bestCount) {
			best = owner;
			bestCount = count;
		}
	}
	return bestCount >= 2 ? best : "";
}

/** 读 git 全局配置单项（读不到 → 空串）。 */
export function gitConfig(key: string): string {
	const res = Bun.spawnSync([
		"git",
		"config",
		"--get",
		key,
	]);
	return res.success ? res.stdout.toString().trim() : "";
}

/**
 * 汇总问询答案。--name 给定时视为完全非交互：缺省字段静默取默认值
 * （desc 空、owner 走兄弟项目探测）；否则交互式逐项问询（需 TTY）。
 */
export async function resolveAnswers(
	flags: Record<string, string>,
): Promise<Answers> {
	const detected = detectOwner();
	const finish = (
		rawName: string,
		desc: string,
		ownerInput: string,
	): Answers => {
		const name = normalizeName(rawName);
		if (name === null) {
			throw new Error(`非法的包名：${rawName}`);
		}
		const owner =
			ownerInput.trim() !== ""
				? ownerInput.trim()
				: detected;
		return {
			name,
			dirname: deriveDirname(name),
			desc: desc.trim(),
			owner,
		};
	};

	if (flags["name"] !== undefined) {
		return finish(
			flags["name"],
			flags["desc"] ?? "",
			flags["owner"] ?? "",
		);
	}

	if (!process.stdin.isTTY) {
		throw new Error(
			"非交互环境下必须提供 --name=<包名>（可选 --desc= --owner=）",
		);
	}
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const rawName = await rl.question(
			"📦 包名（可省略 koishi-plugin- 前缀）：",
		);
		const desc = await rl.question("📝 描述（可选）：");
		const ownerHint =
			detected !== "" ? `（回车 = ${detected}）` : "";
		const owner = await rl.question(
			`🐙 GitHub 所有者${ownerHint}：`,
		);
		return finish(rawName, desc, owner);
	} finally {
		rl.close();
	}
}
