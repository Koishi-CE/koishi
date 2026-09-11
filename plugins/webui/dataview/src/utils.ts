// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 数据库 RPC 报文的序列化编解码（node 侧入口）。
 *
 * 实现位于同目录 codec.ts（与 client 侧共享的纯协议模块，两侧差异
 * 仅在 `b` 前缀的复活语义：node 侧默认丢弃 binary 为 undefined）；
 * 此处保留文件与导出面，`export *` 的公开 API 不变。
 */

export { deserialize, serialize } from "./codec.ts";
