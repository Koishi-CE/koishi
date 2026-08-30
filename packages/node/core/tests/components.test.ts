/**
 * 内置消息组件（模板标签）测试。
 *
 * 六个内置组件全部经真实发送链路（transform 渲染）验证：
 * execute 内联执行、prompt 交互追问、i18n 文案渲染、random 随机选取、
 * plural 复数形式、i18n:time 时长人性化。
 *
 * 注意：h.parse 会把显式 <text> 标签解析成空的 text 包装元素，
 * 故此处统一用 h() 工厂直接构造元素树，保证 children 形态干净。
 */
import { afterAll, beforeAll, describe, it } from "bun:test";
import { App, h } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";

const app = new App();
app.plugin(mock);
const client = app.mock.client("123");

app.i18n.define("zh-CN", "greet.hello", "你好，{0}");

app.command("echo [content:text]").action((_, text) => text);

// 各组件的触发入口：指令直接返回对应标签的元素
app.command("random").action(() => h("random", {}, [h.text("a"), h.text("b")]));
app
	.command("plural0")
	.action(() => h("plural", { count: "0" }, [h.text("zero"), h.text("one")]));
app
	.command("plural1")
	.action(() => h("plural", { count: "1" }, [h.text("zero"), h.text("one")]));
app
	.command("plurallast")
	.action(() => h("plural", {}, [h.text("zero"), h.text("one")]));
app
	.command("i18ntag")
	.action(() => h("i18n", { path: "greet.hello" }, [h.text("世界")]));
app.command("execute-tag").action(() => "<execute>echo 内联</execute>");
app.command("time1").action(() => h("i18n:time", { value: "183600000" }));
app.command("time2").action(() => h("i18n:time", { value: "90000" }));
app.command("time3").action(() => h("i18n:time", { value: "30000" }));
app.command("ask").action(() => "<prompt>请输入</prompt>");

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Built-in Components", () => {
	it("random 随机选取一个子元素", async () => {
		await client.shouldReply("random", /^[ab]$/);
	});

	it("plural 按 count 选取变体", async () => {
		await client.shouldReply("plural0", "zero");
		await client.shouldReply("plural1", "one");
		// 未提供 count 时默认取最后一个子元素
		await client.shouldReply("plurallast", "one");
	});

	it("i18n 渲染指定路径的文案", async () => {
		await client.shouldReply("i18ntag", "你好，世界");
	});

	it("execute 内联执行指令", async () => {
		await client.shouldReply("execute-tag", "内联");
	});

	it("i18n:time 时长人性化", async () => {
		// 2 天 3 小时（低级单位过半进位场景）
		await client.shouldReply("time1", "2 天 3 小时");
		// 90 秒 → 进位为分钟，且剩余秒数超过 1 秒时一并展示
		await client.shouldReply("time2", "1 分钟 30 秒");
		// 不足半分钟按秒取整
		await client.shouldReply("time3", "30 秒");
	});

	it("prompt 先发送子内容再等待回复", async () => {
		await client.shouldReply("ask", "请输入");
		await client.shouldReply("42", "42");
	});
});
