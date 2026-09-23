// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

// 宿主 SPA 借用浏览器运行时库（@koishi-ce/client）的全局类型垫片：
// *.vue / *.yaml 模块声明、schemastery-vue/client 虚拟子路径，以及
// @koishi-ce/plugin-console 的公开面手写声明。
//
// 这里必须用跳包相对路径：client 是纯 TS 源码包（无 d.ts 产物），
// `reference types` 走不了它的 exports 条件，本仓类型检查（tsconfig.web.json
// 的 include 含本目录）依赖此路径成立。npm 安装形态下该路径不存在，但下游
// 不会对 node_modules 内的 app 跑 tsc——那里的 .vue 由构建期 compiler-sfc
// 处理，类型面不经过本文件。
/// <reference path="../../client/src/shims.d.ts" />
