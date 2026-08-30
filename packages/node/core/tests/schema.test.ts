/**
 * Schema 扩展工厂与 SchemaService（ctx.schema）测试。
 *
 * 覆盖 Koishi 特有的四个 Schema 工厂（computed / filter / path / dynamic）
 * 的角色标记与实例方法 computed()，以及注册表服务的惰性创建、
 * 按 order 排序插入、片段随定义方上下文销毁移除、set 整体覆写。
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "bun:test";
import { App, Schema } from "@koishi-ce/koishi";
import "./shape.ts";

const app = new App();

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Schema Factories", () => {
	it("Schema.dynamic 打上 dynamic 角色并携带名称", () => {
		const schema = Schema.dynamic("my-plugin");
		expect(schema.meta.role).toBe("dynamic");
		expect(schema.meta.extra).toHaveShape({ name: "my-plugin" });
	});

	it("Schema.filter 打上 filter 角色", () => {
		expect(Schema.filter().meta.role).toBe("filter");
	});

	it("Schema.path 打上 path 角色并携带选项", () => {
		const schema = Schema.path({ allowCreate: true, filters: ["file"] });
		expect(schema.meta.role).toBe("path");
		expect(schema.meta.extra).toHaveShape({ allowCreate: true });
	});

	it("Schema.computed 包装内层为计算属性", () => {
		const schema = Schema.computed(Schema.string());
		expect(schema.meta.role).toBe("computed");
		// $switch 是 computed 的隐藏分支写法（运行时受支持，未进入调用签名的
		// 参数类型），经参数形状收窄后传入
		const input = { $switch: { branches: [] } } as unknown as Parameters<
			typeof schema
		>[0];
		expect(schema(input)).toHaveShape({ $switch: { branches: [] } });
	});

	it("实例方法 computed() 沿用原默认值", () => {
		const schema = Schema.string().default("x").computed();
		expect(schema.meta.role).toBe("computed");
		expect(schema.meta.default).toBe("x");
	});
});

describe("Schema Service", () => {
	it("get 惰性创建空的 intersect 节点", () => {
		const schema = app.schema.get("test.lazy");
		expect(schema.type).toBe("intersect");
		expect(schema.list).toEqual([]);
	});

	it("extend 按 order 降序插入片段并广播事件", () => {
		const listener = jest.fn();
		app.on("internal/schema", listener);
		app.schema.extend("test.order", Schema.object({ z: Schema.string() }), 5);
		app.schema.extend("test.order", Schema.object({ a: Schema.string() }), 1);
		app.schema.extend("test.order", Schema.object({ m: Schema.string() }), 3);
		const list = app.schema.get("test.order").list ?? [];
		expect(list.map((item) => item.toString())).toEqual([
			"{ z?: string }",
			"{ m?: string }",
			"{ a?: string }",
		]);
		expect(listener).toHaveBeenCalled();
	});

	it("构造时预置 intercept.http 网络拦截配置", () => {
		const schema = app.schema.get("intercept.http");
		expect(schema.list).toHaveLength(1);
		expect(schema.toString()).toContain("timeout");
	});

	it("extend / set 的内容随定义方上下文销毁移除", () => {
		// 注意：dispose 一个 extend fork 会使根作用域失效，
		// 因此两个 fork 须在任意 dispose 之前全部创建，且本用例须放在最后
		const forkA = app.extend();
		forkA.schema.extend("test.dispose", Schema.object({ b: Schema.string() }));
		const forkB = app.extend();
		forkB.schema.set("test.override", Schema.string());
		expect(app.schema.get("test.dispose").list).toHaveLength(1);
		expect(app.schema.get("test.override").type).toBe("string");

		forkA.scope.dispose();
		expect(app.schema.get("test.dispose").list).toHaveLength(0);
		forkB.scope.dispose();
		// 删除后再次 get 会重建为空的 intersect
		expect(app.schema.get("test.override").type).toBe("intersect");
	});
});
