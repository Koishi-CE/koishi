// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

import { describe, expect, it } from "bun:test";
import { dockerFiles } from "../docker.ts";

/**
 * `--docker` 容器化模板的静态内容断言。
 *
 * 这些文件是「可变工作区」方案的骨架，关键语义一旦被改坏（例如退回
 * 不可变镜像、丢掉 frozen lockfile、单文件挂载 koishi.yml、entrypoint
 * 不再降权），容器内的插件市场闭环就会失效，故逐项对账。
 */

describe("容器化模板文件", () => {
	it("四个文件齐备，.dockerignore 以点前缀落盘", () => {
		expect(Object.keys(dockerFiles).sort()).toEqual([
			".dockerignore",
			"Dockerfile",
			"compose.yaml",
			"docker-entrypoint.sh",
		]);
		for (const content of Object.values(dockerFiles)) {
			expect(content.length).toBeGreaterThan(0);
		}
	});

	it("Dockerfile：seed 预装 + frozen lockfile + 官方 Bun 多架构镜像", () => {
		const file = dockerFiles["Dockerfile"] ?? "";
		// 官方 Bun 镜像同时提供 amd64 / arm64，且与 packageManager 钉线一致
		expect(file).toContain("FROM oven/bun:1.4.2-debian");
		// 初始依赖在 /seed 预热，首次挂载空卷无需联网安装
		expect(file).toContain("WORKDIR /seed");
		expect(file).toContain("--frozen-lockfile");
		// 缺锁文件时退化安装，不能直接失败（生成项目未必已 bun install）
		expect(file).toContain("bun install --production");
		// 运行时工作区
		expect(file).toContain("WORKDIR /app");
		// 容器内必须监听全部网卡，否则端口映射无效
		expect(file).toContain("KOISHI_HOST=0.0.0.0");
		// CMD 直指 CLI 入口：bun run 会多包一层进程，信号被截断
		expect(file).toContain(
			"node_modules/@koishi-ce/koishi/lib/cli/index.mjs",
		);
		// 降权工具：gosu 是 exec 语义，PID 1 仍是 Koishi CLI
		expect(file).toContain("gosu");
	});

	it("entrypoint：空工作区初始化 + 属主对齐 + 降权启动", () => {
		const file = dockerFiles["docker-entrypoint.sh"] ?? "";
		// POSIX sh，且 shebang 必须落在第一行（CRLF 会让容器报 not found）
		expect(file.startsWith("#!/bin/sh\n")).toBe(true);
		// 首次挂载空卷：从 /seed 初始化
		expect(file).toContain(
			'cp -a "$SEED_DIR/." "$APP_DIR/"',
		);
		// 有锁走 frozen，无锁退化
		expect(file).toContain("--frozen-lockfile");
		// 权限对齐：宿主 bind mount 的 uid 与镜像内 bun 用户可能不一致
		expect(file).toContain("chown -R");
		// 降权后 exec，保持 PID 1 为 Koishi CLI
		expect(file).toContain("exec gosu");
		// 不能再引入单文件挂载时代的“只复制配置文件”逻辑
		expect(file).toContain('mkdir -p "$APP_DIR/data"');
	});

	it("compose：可变工作区 + 缓存卷 + init + 动态健康检查", () => {
		const file = dockerFiles["compose.yaml"] ?? "";
		// 目录级挂载（禁止单文件挂载 koishi.yml）
		expect(file).toContain("- .:/app");
		// 命名卷模式逃生舱
		expect(file).toContain("- koishi-data:/app");
		// Bun 安装缓存：市场二次安装可命中
		expect(file).toContain(
			"- bun-cache:/home/bun/.bun/install/cache",
		);
		// PID 1 之外的孤儿进程回收
		expect(file).toContain("init: true");
		// 端口不硬编码：容器内 5140，宿主侧可配
		expect(file).toContain("${HOST_PORT:-5140}");
		// 健康检查读 KOISHI_PORT 兜底 5140，且间隔放宽
		expect(file).toContain(
			"process.env.KOISHI_PORT || 5140",
		);
		expect(file).toContain("interval: 60s");
		expect(file).toContain("stop_grace_period: 30s");
	});

	it("模板文本统一 LF：entrypoint 的 shebang 不能被 CRLF 污染", () => {
		for (const [name, content] of Object.entries(
			dockerFiles,
		)) {
			expect(content.includes("\r\n"), name).toBe(false);
		}
	});
});
