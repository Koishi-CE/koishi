// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * insight 前端的公共类型与常量。
 *
 * Node / Link 在服务端数据（Insight.Node / Insight.Link）基础上叠加
 * d3-force 的模拟字段（坐标、速度、固定点等），供力导向图模拟与渲染共用。
 */
import type Insight from "@koishi-ce/plugin-insight";
import type * as d3 from "d3-force";

/** 图节点：模拟期间由 d3 写入 x/y/vx/vy，lastX/lastY 用于拖拽增量的记录。 */
export interface Node
	extends Insight.Node,
		d3.SimulationNodeDatum {
	lastX?: number;
	lastY?: number;
	active?: boolean;
}

/**
 * 图边：source/target 在 d3 初始化后由 uid 解析为节点对象引用，
 * 类型（solid/dashed）沿用服务端语义。
 */
export interface Link
	extends Omit<Insight.Link, "source" | "target">,
		d3.SimulationLinkDatum<Node> {
	source: Node;
	target: Node;
}

// erasableSyntaxOnly 不允许 namespace 内运行时值;改为 as const 对象,
// 保持 constants.arrowLength 等访问面不变
/** 连线箭头的几何常量：长度、距目标节点的留白、半张角。 */
export const constants = {
	arrowLength: 10,
	arrowOffset: 10,
	arrowAngle: Math.PI / 6,
} as const;
