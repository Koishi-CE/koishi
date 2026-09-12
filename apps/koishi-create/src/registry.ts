// SPDX-License-Identifier: MIT
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 本机 npm registry 配置探测。
 *
 * 实现已收敛到 @koishi-ce/utils 的 npm-registry 模块（与 market 插件的
 * installer 共享同一实现），此处按原公共 API 再导出，调用方与测试的
 * 导入路径不变。远程模板下载流程见 remote.ts，不在本文件。
 */
export {
	getLocalRegistry,
	readNpmrcRegistry,
} from "@koishi-ce/utils";
