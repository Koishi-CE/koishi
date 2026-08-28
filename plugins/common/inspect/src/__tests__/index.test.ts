/**
 * inspect 插件测试：验证当前会话、at / sharp 元素参数、
 * 非法参数与引用消息四类输入的元信息输出。
 */
import { afterAll, beforeAll, describe, it } from "bun:test";
import { Context } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import * as inspect from "../src";

const app = new Context();

app.plugin(inspect);
app.plugin(mock);

const client = app.mock.client("123", "456");

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("@koishi-ce/plugin-inspect", () => {
	// 裸 inspect 输出会话元信息；at / sharp 参数输出对应 ID；非法参数报错；引用消息输出被引用者信息
	it("basic support", async () => {
		await client.shouldReply(
			"inspect",
			new RegExp(
				[
					"平台名：mock",
					"消息 ID：\\d+",
					"频道 ID：456",
					"群组 ID：456",
					"用户 ID：123",
					"自身 ID：514",
				].join("\n"),
			),
		);

		await client.shouldReply('inspect <at id="321"/>', "用户 ID：321");
		await client.shouldReply('inspect <sharp id="654"/>', "频道 ID：654");
		await client.shouldReply("inspect foobar", "参数无法解析。");

		await client.shouldReply(
			'<quote id="114514"/> inspect foobar',
			new RegExp(
				[
					"平台名：mock",
					"消息 ID：114514",
					"频道 ID：.*",
					"群组 ID：456",
					"用户 ID：.*",
					"自身 ID：514",
				].join("\n"),
			),
		);
	});
});
