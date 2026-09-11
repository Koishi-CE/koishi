// SPDX-License-Identifier: MIT
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * Context 静态符号的叶子定义。
 *
 * 服务层（permission.ts 等）若为取得符号而值依赖 context/index.ts，
 * 会与后者装配服务类的值导入互成循环依赖。符号本体在此叶子模块定义，
 * Context 类与各消费方分别引用，环即断开（Context.shadow 的对外
 * API 形态保持不变）。
 */

/** shadow 会话标记：以其它会话为模板派生的"影子会话"会带上该符号属性 */
export const sessionShadow = Symbol.for("session.shadow");
