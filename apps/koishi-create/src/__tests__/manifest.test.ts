import { expect, test } from "bun:test";
import { detectAgent, type Manifest, renderManifest } from "../index";

test("renderManifest 基础改写：替换项目名、标记 private、版本归零", () => {
	const source: Manifest = {
		name: "@koishijs/boilerplate",
		version: "1.0.0",
		workspaces: ["koishi-app/*"],
		scripts: { start: "koishi start" },
	};
	const output = JSON.parse(renderManifest(source, "my-app", false));
	expect(output.name).toBe("my-app");
	expect(output.private).toBe(true);
	expect(output.version).toBe("0.0.0");
	// 未触碰的字段原样保留
	expect(output.scripts).toEqual({ start: "koishi start" });
	expect(output.workspaces).toEqual(["koishi-app/*"]);
	// 与模板一致的两空格缩进 + 结尾换行
	expect(renderManifest(source, "my-app", false).endsWith("}\n")).toBe(true);
});

test("renderManifest prod 模式：删除 workspaces 与 devDependencies", () => {
	const source: Manifest = {
		name: "@koishijs/boilerplate",
		workspaces: ["koishi-app/*"],
		devDependencies: { koishi: "^4.18.11" },
	};
	const output = JSON.parse(renderManifest(source, "my-app", true));
	expect(output.name).toBe("my-app");
	expect("workspaces" in output).toBe(false);
	expect("devDependencies" in output).toBe(false);
});

test("detectAgent：yarn / pnpm 跟随探测，其余一律 bun", () => {
	const key = "npm_config_user_agent";
	process.env[key] = "npm/10.9.2 node/v22.14.0 x64 workspaces/false";
	expect(detectAgent()).toBe("bun");
	process.env[key] = "yarn/1.22.22 npm/? node/v22.14.0 x64";
	expect(detectAgent()).toBe("yarn");
	process.env[key] = "pnpm/10.12.1 npm/? node/v22.14.0 x64";
	expect(detectAgent()).toBe("pnpm");
	delete process.env[key];
	expect(detectAgent()).toBe("bun");
});
