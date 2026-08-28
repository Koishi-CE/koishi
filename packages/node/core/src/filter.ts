/**
 * 会话过滤服务（ctx.filter / ctx.$filter）。
 *
 * Koishi 中每个上下文（Context）都可以挂一个 `filter`，决定"哪些会话能激活
 * 该上下文下注册的功能"（中间件、指令、监听器等）。本文件实现过滤器的
 * 组合代数：any / never / union / intersect / exclude 以及按
 * user / self / guild / channel / platform / private 的快捷筛选。
 *
 * 过滤器在运行时由 runtime 自动聚合：父 runtime 的过滤器等价于
 * "任一子 runtime 的过滤器通过"，从而实现事件分发时的剪枝。
 */
import { defineProperty } from "cosmokit";
import type { Eval } from "minato";
import { Context } from "./context";
import type { Channel, User } from "./database";
import type { Session } from "./session";

/** 计算属性的附加选项。 */
export namespace Computed {
	export interface Options {
		/** 计算过程中需要预取的用户表字段 */
		userFields?: User.Field[];
		/** 计算过程中需要预取的频道表字段 */
		channelFields?: Channel.Field[];
	}
}

/**
 * 计算属性类型：一个值可以是静态的，也可以延迟求值。
 *
 * - `T`：静态值，所有会话共用；
 * - `Eval.Expr<T>`：minato 求值表达式，在数据库层计算（如引用 user 表字段）；
 * - `(session) => T`：函数，每次用到时以当前会话为入参动态计算。
 *
 * 插件配置中大量使用该类型（如权限等级、开关项），让配置可以按用户/频道变化。
 */
export type Computed<T> =
	| T
	| Eval.Expr<T>
	| ((session: Session<any, any, any>) => T);
/**
 * 会话过滤器：接收一个 Session，返回该会话是否允许通过。
 * 挂在 Context 上即成为该上下文的事件准入条件。
 */
export type Filter = (session: Session<any, any, any>) => boolean;

declare module "./context" {
	interface Context {
		/** 过滤服务实例，提供过滤器组合的底层方法 */
		$filter: FilterService;
		/** 当前上下文的会话过滤器 */
		filter: Filter;
		/** 接受所有会话（过滤恒真） */
		any(): this;
		/** 拒绝所有会话（过滤恒假） */
		never(): this;
		/** 并集：当前过滤器或 arg 通过即通过 */
		union(arg: Filter | this): this;
		/** 交集：当前过滤器与 arg 都通过才通过 */
		intersect(arg: Filter | this): this;
		/** 差集：当前过滤器通过且 arg 不通过才通过 */
		exclude(arg: Filter | this): this;
		/** 只接受指定 userId 的会话；不传参数则要求 userId 非空 */
		user(...values: string[]): this;
		/** 只接受指定 selfId（机器人账号）的会话 */
		self(...values: string[]): this;
		/** 只接受指定 guildId 的会话 */
		guild(...values: string[]): this;
		/** 只接受指定 channelId 的会话 */
		channel(...values: string[]): this;
		/** 只接受指定平台的会话 */
		platform(...values: string[]): this;
		/** 只接受私聊（isDirect）会话 */
		private(...values: string[]): this;
	}
}

/**
 * 生成"按 Session 某个字段筛选"的过滤器上下文。
 *
 * 传了 values 则匹配字段值是否在列表内（白名单语义）；
 * 不传 values 则只要求该字段为真值（非空即通过），用于"任意群 / 任意用户"这类场景。
 */
function property<K extends keyof Session>(
	ctx: Context,
	key: K,
	...values: Session[K][]
) {
	return ctx.intersect((session: Session) => {
		return values.length ? values.includes(session[key]) : !!session[key];
	});
}

/** 过滤服务：把过滤器组合方法挂到每个 Context 上。 */
export class FilterService {
	private ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
		// 标记当前活跃上下文，供 cordis 依赖注入系统识别服务归属
		defineProperty(this, Context.current, ctx);

		// 根上下文默认放行所有会话
		ctx.filter = () => true;
		ctx.on("internal/runtime", (runtime) => {
			// uid 为空的 runtime（匿名/临时运行时）不参与过滤聚合
			if (!runtime.uid) return;
			// 父 runtime 的过滤器 = 任一子 runtime 的过滤器通过即通过。
			// 这样事件分发时只需自顶向下试探，遇到通过的分枝才继续下钻
			runtime.ctx.filter = (session) => {
				return runtime.children.some((p) => p.ctx.filter(session));
			};
		});
	}

	/** 返回一个接受所有会话的新上下文。 */
	any() {
		return this.ctx.extend({ filter: () => true });
	}

	/** 返回一个拒绝所有会话的新上下文。 */
	never() {
		return this.ctx.extend({ filter: () => false });
	}

	/** 与传入过滤器（或另一上下文的过滤器）取并集，返回新上下文。 */
	union(arg: Filter | Context) {
		const filter = typeof arg === "function" ? arg : arg.filter;
		return this.ctx.extend({
			filter: (s: Session) => this.ctx.filter(s) || filter(s),
		});
	}

	/** 与传入过滤器取交集，返回新上下文。 */
	intersect(arg: Filter | Context) {
		const filter = typeof arg === "function" ? arg : arg.filter;
		return this.ctx.extend({
			filter: (s: Session) => this.ctx.filter(s) && filter(s),
		});
	}

	/** 从当前过滤器中排除传入过滤器命中的会话，返回新上下文。 */
	exclude(arg: Filter | Context) {
		const filter = typeof arg === "function" ? arg : arg.filter;
		return this.ctx.extend({
			filter: (s: Session) => this.ctx.filter(s) && !filter(s),
		});
	}

	/** 只保留指定用户的会话；不传参数则要求会话带有 userId。 */
	user(...values: string[]) {
		return property(this.ctx, "userId", ...values);
	}

	/** 只保留指定机器人账号（selfId）的会话。 */
	self(...values: string[]) {
		return property(this.ctx, "selfId", ...values);
	}

	/** 只保留指定群的会话；不传参数则要求会话发生在群聊中。 */
	guild(...values: string[]) {
		return property(this.ctx, "guildId", ...values);
	}

	/** 只保留指定频道的会话。 */
	channel(...values: string[]) {
		return property(this.ctx, "channelId", ...values);
	}

	/** 只保留指定平台（protocol）的会话。 */
	platform(...values: string[]) {
		return property(this.ctx, "platform", ...values);
	}

	/** 只保留私聊会话。 */
	private() {
		return this.ctx.intersect((session) => session.isDirect);
	}
}
