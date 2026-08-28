import { beforeAll, describe, it } from "bun:test";
import { App } from "@koishi-ce/koishi";
import admin from "@koishi-ce/plugin-admin";
import mock from "@koishi-ce/plugin-mock";
import memory from "@koishijs/plugin-database-memory";
import { expect, use } from "chai";
import promise from "chai-as-promised";

/**
 * @koishi-ce/plugin-admin 聊天指令的行为测试：
 * 覆盖 user/authorize 的目标校验与权限约束、channel/assign 的受理人指派，
 * 断言以中文回执文案为准。
 */
use(promise);

const app = new App();

app.plugin(memory);
app.plugin(mock);
app.plugin(admin);

const client1 = app.mock.client("123", "321");
const client2 = app.mock.client("123");

beforeAll(() => app.start());

beforeAll(async () => {
	await app.mock.initUser("123", 4);
	await app.mock.initUser("456", 3);
	await app.mock.initUser("789", 4);
	await app.mock.initChannel("321");
	await app.mock.initChannel("654");
});

describe("Admin Commands", () => {
	it("user/authorize", async () => {
		// 校验缺参 / 非法目标 / 参数格式错误的报错路径，
		// 以及权限边界（不可操作同级或更高权限用户）与正常改写
		await client1.shouldReply("authorize", "请指定目标用户。");
		await client1.shouldReply(
			"authorize -u nan",
			"选项 user 输入无效，请指定正确的用户。",
		);
		await client1.shouldReply("authorize -u @789", "权限不足。");
		await client1.shouldReply(
			"authorize -u @456 1.5",
			"参数 value 输入无效，请提供一个非负整数。",
		);
		await client1.shouldReply("authorize -u @456 3", "用户数据未改动。");
		await client1.shouldReply("authorize -u @456 4", "权限不足。");
		await client1.shouldReply("authorize -u @456 2", "用户数据已修改。");
		await client1.shouldReply("authorize -u @111 1", "用户数据已修改。");
	});

	it("channel/assign", async () => {
		// 校验私聊缺 -c、非法频道、跨平台受理人等报错路径，
		// 以及受理人缺省（指派给机器人自身）与显式指派的落库结果
		await app.mock
			.client("123")
			.shouldReply(
				"assign",
				"当前不在群组上下文中，请使用 -c 参数指定目标频道。",
			);
		await client1.shouldReply(
			"assign -c nan",
			"选项 channel 输入无效，请指定正确的频道。",
		);
		await client1.shouldReply("assign -c #321", "频道数据未改动。");
		await client1.shouldReply(
			"assign -c #321 nan",
			"参数 bot 输入无效，请指定正确的用户。",
		);
		await client1.shouldReply(
			"assign -c #321 @foo:bar",
			"受理人应与目标频道属于同一平台。",
		);
		await client1.shouldReply("assign -c #333", "频道数据已修改。");

		const getChannel = () =>
			expect(app.database.getChannel("mock", "321")).eventually;
		await getChannel().to.have.property("assignee", "514");
		await client1.shouldReply("assign -c #321 @123", "频道数据已修改。");
		await getChannel().to.have.property("assignee", "123");
		await client2.shouldReply("assign -c #321", "频道数据已修改。");
		await getChannel().to.have.property("assignee", "514");
	});
});
