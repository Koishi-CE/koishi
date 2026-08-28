import { afterAll, beforeAll, describe, it } from "bun:test";
import { App } from "@koishi-ce/koishi";
import mock from "@koishi-ce/plugin-mock";
import memory from "@minatojs/driver-memory";
import { expect, use } from "chai";
import promise from "chai-as-promised";
import { shape } from "../../../../scripts/testing/chai-shape";

use(shape);
use(promise);

const app = new App();

app.plugin(mock);
app.plugin(memory);

beforeAll(() => app.start());
afterAll(() => app.stop());

describe("Database API", () => {
	describe("User Operations", () => {
		it("db.setUser() on non-existing user", async () => {
			await expect(app.database.setUser("mock", "A", { authority: 1 })).to.be
				.rejected;
			await expect(app.database.getUser("mock", "A")).eventually.not.to.be.ok;
		});

		it("db.createUser() on non-existing user", async () => {
			await app.database.createUser("mock", "A", { authority: 1 });
			await expect(app.database.getUser("mock", "A")).eventually.to.have.shape({
				authority: 1,
			});
		});

		it("db.setUser() on existing user", async () => {
			await app.database.setUser("mock", "A", { authority: 2 });
			await expect(app.database.getUser("mock", "A")).eventually.to.have.shape({
				authority: 2,
			});
		});
	});

	describe("Channel Operations", () => {
		it("db.setChannel() on non-existing channel", async () => {
			await app.database.setChannel("mock", "A", { assignee: "123" });
			await expect(app.database.getChannel("mock", "A")).eventually.not.to.be
				.ok;
		});

		it("db.createChannel() on non-existing channel", async () => {
			await app.database.createChannel("mock", "A", { assignee: "123" });
			await expect(
				app.database.getChannel("mock", "A"),
			).eventually.to.have.shape({ assignee: "123" });
		});

		it("db.setChannel() on existing channel", async () => {
			await app.database.setChannel("mock", "A", { assignee: "321" });
			await expect(
				app.database.getChannel("mock", "A"),
			).eventually.to.have.shape({ assignee: "321" });
		});

		it("db.getAssignedChannels()", async () => {
			await app.database.createChannel("mock", "B", {
				assignee: app.bots[0].selfId,
			});
			await app.database.createChannel("mock", "C", {
				assignee: app.bots[0].selfId,
			});
			await expect(
				app.database.getAssignedChannels(null),
			).eventually.to.have.length(2);
			await expect(
				app.database.getAssignedChannels(null, { mock: ["321"] }),
			).eventually.to.have.length(1);
		});

		it("db.getChannel() with multiple ids", async () => {
			await expect(
				app.database.getChannel("mock", ["A"]),
			).eventually.to.have.length(1);
			await app.database.remove("channel", { id: "A" });
			await expect(
				app.database.getChannel("mock", ["A"]),
			).eventually.to.deep.equal([]);
		});
	});
});
