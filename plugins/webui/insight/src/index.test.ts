import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Console, type Entry } from "@koishi-ce/console";
import { App, type Context, type Plugin } from "@koishi-ce/koishi";
import insight from "./index.ts";

// Insight 类仅默认导出，实例类型经构造器派生（namespace 侧的 Payload 等随实例可用）
type Insight = InstanceType<typeof insight>;

/** 控制台服务桩：仅实现入口登记所需的最小面。 */
class FakeConsole extends Console {
	protected resolveEntry(_files: Entry.Files, _key: string): string[] {
		return [];
	}
}

/** 可复用插件（fork 两次形成 A -> X / Y 形态）。 */
const reusablePlugin = {
	name: "reusable-a",
	reusable: true,
	apply(_ctx: Context) {},
};

/** 普通不可复用插件。 */
const normalPlugin = {
	name: "normal-b",
	apply(_ctx: Context) {},
};

/** 依赖 console 服务的插件（形成 dashed 注入边）。 */
const injectedPlugin = {
	name: "injected-c",
	inject: { required: ["console"] },
	apply(_ctx: Context) {},
};

const app = new App();

app.plugin(FakeConsole as unknown as Plugin.Constructor<App>);
app.plugin(insight);

const service = () => app.get("console.services.insight") as Insight;

beforeAll(async () => {
	await app.start();
	// 在 insight 服务就绪后加载被观测插件，同时驱动 internal/fork 事件防抖刷新
	app.plugin(reusablePlugin);
	app.plugin(reusablePlugin);
	app.plugin(normalPlugin);
	// inject: { required: [...] } 是 cordis 3 旧形态，类型层转型为 Plugin.Object 穿透
	app.plugin(injectedPlugin as unknown as Plugin.Object<App>);
	app.plugin((_ctx) => {});
});

afterAll(async () => {
	await app.stop();
});

describe("insight 依赖图服务", () => {
	it("注册控制台入口", () => {
		expect(Object.keys(app.console.entries).length).toBeGreaterThan(0);
	});

	it("生成包含根应用与各插件节点的图数据", async () => {
		const { nodes, edges } = await service().get();
		const byName = new Map(nodes.map((node) => [node.name, node]));

		// 根应用节点（uid 为 0，isRoot 标记）
		const root = nodes.find((node) => node.isRoot);
		expect(root).toBeDefined();
		expect(root?.uid).toBe(0);

		// 插件短横线名转大驼峰
		expect(byName.has("ReusableA")).toBe(true);
		expect(byName.has("NormalB")).toBe(true);
		// 匿名函数插件显示 Anonymous
		expect(byName.has("Anonymous")).toBe(true);

		// reusable 插件 fork 两次产生两个节点
		expect(nodes.filter((node) => node.name === "ReusableA")).toHaveLength(2);
		// normal 插件只有一个主状态节点
		expect(nodes.filter((node) => node.name === "NormalB")).toHaveLength(1);

		// 存在实线（fork 调用）与虚线（服务注入）两类边
		expect(edges.some((edge) => edge.type === "solid")).toBe(true);
		expect(edges.some((edge) => edge.type === "dashed")).toBe(true);

		// dashed 边的源是 console 服务所在 scope
		const dashed = edges.filter((edge) => edge.type === "dashed");
		const dashedTargets = dashed.map((edge) => edge.target);
		const injectedNode = nodes.find(
			(node) => node.name === "InjectedC" || node.name === "injected-c",
		);
		expect(injectedNode).toBeDefined();
		// 上方断言已保证节点存在，此处收窄 uid 供 toContain 比对
		expect(dashedTargets).toContain(injectedNode!.uid);
	});

	it("节点携带 weight（disposables 数量）与状态字段", async () => {
		const { nodes } = await service().get();
		for (const node of nodes) {
			expect(typeof node.weight).toBe("number");
			expect(typeof node.status).toBeTruthy();
		}
	});

	it("refresh 触发重新计算（无客户端时安全）", async () => {
		const svc = service();
		await expect(svc.refresh()).resolves.toBeUndefined();
	});
});
