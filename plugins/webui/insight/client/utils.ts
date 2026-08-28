import type Insight from "@koishi-ce/plugin-insight";
import type * as d3 from "d3-force";

export interface Node extends Insight.Node, d3.SimulationNodeDatum {
	lastX?: number;
	lastY?: number;
	active?: boolean;
}

export interface Link
	extends Omit<Insight.Link, "source" | "target">,
		d3.SimulationLinkDatum<Node> {
	source: Node;
	target: Node;
}

// erasableSyntaxOnly 不允许 namespace 内运行时值;改为 as const 对象,
// 保持 constants.arrowLength 等访问面不变
export const constants = {
	arrowLength: 10,
	arrowOffset: 10,
	arrowAngle: Math.PI / 6,
} as const;
