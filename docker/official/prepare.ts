// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 官方镜像的构建前准备（workflow 与本地构建共用）。
 *
 * 生成 docker/official/seed/（package.json + koishi.yml）并复制 entrypoint。
 * seed 与 create-koishi-ce 的默认模板同源：package.json 走 renderManifest
 * 的 prod 模式（去掉 workspaces / devDependencies），koishi.yml 直接复制
 * 模板文件。生成物不入库（见 .gitignore），每次构建重新生成，避免与模板
 * 双份维护漂移。
 *
 * 用法：bun docker/official/prepare.ts
 */
import {
	copyFileSync,
	mkdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { renderManifest } from "../../apps/koishi-create/src/manifest.ts";
import { baseManifest } from "../../apps/koishi-create/src/template.ts";

const root = import.meta.dir;
const repo = join(root, "../..");
const seed = join(root, "seed");

mkdirSync(seed, { recursive: true });
writeFileSync(
	join(seed, "package.json"),
	renderManifest(baseManifest(), "koishi-ce", true),
);
copyFileSync(
	join(repo, "apps/koishi-create/src/template/koishi.yml"),
	join(seed, "koishi.yml"),
);
// entrypoint 以 create-koishi-ce 的 --docker 模板为唯一源，官方镜像只复制
copyFileSync(
	join(
		repo,
		"apps/koishi-create/src/docker/docker-entrypoint.sh",
	),
	join(root, "docker-entrypoint.sh"),
);

console.log("官方镜像 seed 已生成：docker/official/seed");
