// koa 3.x 未随包提供类型声明，仓库亦未引入 @types/koa；
// 这里按本目录实际用到的表面积手写垫片。
// DefaultState / DefaultContext / Middleware / ParameterizedContext 是
// @koa/router 自带类型所需的最小命名导出（含 BodyT 泛型参数），缺失或参数
// 数量不符都会导致其中间件签名退化为无上下文类型（回调参数报 implicit any）。
declare module "koa" {
	import type { IncomingMessage, ServerResponse } from "http";

	/** 请求上下文（仅声明 apps/online 用到的成员） */
	export interface Context {
		path: string;
		req: IncomingMessage;
		res: ServerResponse;
		request: { body?: unknown };
		response: { body?: unknown };
		body: unknown;
		type: string;
		status: number;
		redirect(url: string): void;
	}

	export type DefaultState = Record<string, unknown>;
	export type DefaultContext = Context;

	export type Middleware<
		StateT = DefaultState,
		ContextT = DefaultContext,
		BodyT = unknown,
	> = (
		ctx: ParameterizedContext<StateT, ContextT, BodyT>,
		next: () => Promise<void>,
	) => unknown;

	// StateT / BodyT 在本垫片的收窄面里无独立信息，仅为对齐
	// @types/koa 的泛型参数个数而保留
	export type ParameterizedContext<
		StateT = DefaultState,
		ContextT = DefaultContext,
		BodyT = unknown,
	> = ContextT;

	class Koa {
		use<StateT = DefaultState, ContextT = DefaultContext>(
			middleware: Middleware<StateT, ContextT>,
		): this;
		listen(port: number): void;
	}

	export default Koa;
}
