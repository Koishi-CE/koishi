/**
 * Schema 扩展与 Schema 服务（ctx.schema）。
 *
 * Schema（schemastery）是 Koishi 的配置描述体系，用于声明插件配置项、
 * 生成控制台表单与校验用户输入。本文件做两件事：
 *
 * 1. 给全局 Schema 工厂补充 Koishi 特有的构造器：
 *    - `Schema.computed`：计算属性（值可以是静态值 / minato 表达式 / 函数）；
 *    - `Schema.filter`：会话过滤器配置项；
 *    - `Schema.path`：文件路径选择器；
 *    - `Schema.dynamic`：动态加载的子 Schema（由其它插件在运行时提供）。
 * 2. 定义 SchemaService：一个按名字聚合并集（intersect）Schema 的注册表，
 *    供多个插件向同一份配置（如 intercept.http 网络拦截配置）追加字段。
 */
import { Schema } from "@satorijs/core";
import { type Dict, defineProperty, remove } from "cosmokit";
import { Context } from "./context";
import type { Computed } from "./filter";

declare global {
	interface Schemastery<S, T> {
		/** 把当前 Schema 提升为"计算属性" Schema（值可按会话动态求值）。 */
		computed(options?: Computed.Options): Schema<Computed<S>, Computed<T>>;
	}

	namespace Schemastery {
		interface Static {
			/** 文件路径选择器（控制台渲染为路径输入控件） */
			path(options?: Path.Options): Schema<string>;
			/** 会话过滤器配置项（控制台渲染为过滤器编辑器） */
			filter(): Schema<Computed<boolean>>;
			/** 通用计算属性：包装任意内层 Schema，支持 $switch 分支写法 */
			computed<X>(
				inner: X,
				options?: Computed.Options,
			): Schema<Computed<TypeS<X>>, Computed<TypeT<X>>>;
			/** 动态 Schema：实际结构由名为 name 的提供方在运行时决定 */
			dynamic(name: string): Schema;
		}

		namespace Path {
			interface Options {
				/** 文件名过滤规则 */
				filters?: Filter[];
				/** 允许选择尚不存在的路径（创建新文件场景） */
				allowCreate?: boolean;
			}

			type Filter = FileFilter | "file" | "directory";

			interface FileFilter {
				/** 文件名通配符 */
				name: string;
				/** 允许的扩展名列表 */
				extensions: string[];
			}
		}
	}
}

/** 动态 Schema：仅打上 dynamic 角色标记，真实结构由运行时提供方注入。 */
Schema.dynamic = function dynamic(name) {
	return Schema.any().role("dynamic", { name }) as never;
};

/** 过滤器 Schema：仅打上 filter 角色标记，由控制台渲染为过滤器编辑器。 */
Schema.filter = function filter() {
	return Schema.any().role("filter");
};

/**
 * 计算属性 Schema：三选一的联合类型。
 *
 * 1. 内层 Schema 本身（静态值）；
 * 2. 隐藏的 `$switch` 对象（控制台的"分支配置"写法：按 case 选择 then/default）；
 * 3. 隐藏的 any（兼容 minato 表达式 / 函数等程序化写法，不暴露给表单）。
 */
Schema.computed = function computed(inner, options = {}) {
	return Schema.union([
		Schema.from(inner),
		Schema.object({
			$switch: Schema.object({
				branches: Schema.array(
					Schema.object({
						case: Schema.any(),
						then: Schema.from(inner),
					}),
				),
				default: Schema.from(inner),
			}),
		}).hidden(),
		Schema.any().hidden(),
	]).role("computed", options);
};

/** 路径 Schema：字符串加 path 角色，控制台据此渲染文件选择器。 */
Schema.path = function path(options = {}) {
	return Schema.string().role("path", options);
};

/** 实例方法版本：`Schema.string().computed()`，沿用原默认值。 */
Schema.prototype.computed = function computed(this: Schema, options = {}) {
	return Schema.computed(this, options).default(this.meta.default);
};

/** 内部符号：记录每个 Schema 片段在 extend 插入时的排序权重 */
const kSchemaOrder = Symbol("schema-order");

type SchemaWithOrder = Schema & { [kSchemaOrder]?: number };

declare module "@satorijs/core" {
	interface Context {
		/** Schema 注册表服务 */
		schema: SchemaService;
	}

	interface Events {
		/** 名为 name 的聚合 Schema 内容变化时触发（供控制台刷新表单） */
		"internal/schema"(name: string): void;
	}
}

/** Schema 注册表：按名字聚合并集 Schema，支持多方按顺序追加片段。 */
export class SchemaService {
	/** 名字到聚合 Schema 的映射（intersect 节点，list 存各参与方片段） */
	_data: Dict<Schema> = Object.create(null);

	ctx: Context;

	constructor(ctx: Context) {
		this.ctx = ctx;
		// 框架自带的网络拦截配置：所有插件共享的 http 请求全局设置
		this.extend(
			"intercept.http",
			Schema.object({
				timeout: Schema.natural()
					.role("ms")
					.description("等待连接建立的最长时间。"),
				proxyAgent: Schema.string().description("使用的代理服务器地址。"),
				keepAlive: Schema.boolean().description("是否保持连接。"),
			}),
		);
	}

	/**
	 * 向名为 name 的聚合 Schema 追加一个片段。
	 *
	 * @param schema 待追加的 Schema 片段
	 * @param order 排序权重，值大的排在后面（默认 0；无权重的旧片段视为 NaN，
	 *   永远排在末尾，保证兼容）
	 */
	extend(name: string, schema: Schema, order = 0) {
		const caller = this[Context.current];
		const target = this.get(name);
		const list = (target.list ??= []);
		const index = list.findIndex(
			(a) => ((a as SchemaWithOrder)[kSchemaOrder] ?? Number.NaN) < order,
		);
		defineProperty(schema, kSchemaOrder, order);
		if (index >= 0) {
			list.splice(index, 0, schema);
		} else {
			list.push(schema);
		}
		this.ctx.emit("internal/schema", name);
		// 片段随定义方上下文销毁自动移除
		caller?.on("dispose", () => {
			remove(list, schema);
			this.ctx.emit("internal/schema", name);
		});
	}

	/**
	 * 读取名为 name 的聚合 Schema；不存在则惰性创建一个空的 intersect。
	 * 多个参与方的片段合并后表现为"所有字段同时出现"的并集表单。
	 */
	get(name: string) {
		return (this._data[name] ??= Schema.intersect([]));
	}

	/** 整体覆写名为 name 的 Schema（随调用方上下文销毁自动删除）。 */
	set(name: string, schema: Schema) {
		const caller = this[Context.current];
		this._data[name] = schema;
		this.ctx.emit("internal/schema", name);
		caller?.on("dispose", () => {
			delete this._data[name];
			this.ctx.emit("internal/schema", name);
		});
	}
}
