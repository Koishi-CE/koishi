import { describe, expect, it } from "bun:test";
import {
	deriveDirname,
	normalizeName,
	parseFlags,
	renderPackageJson,
} from "../setup.ts";

const VERSIONS = {
	koishi: "^4.18.11",
	"@koishijs/client": "^5.30.4",
	"@koishijs/plugin-console": "^5.30.11",
};

describe("parseFlags", () => {
	it("解析 --key=value 参数", () => {
		expect(parseFlags(["--name=foo", "--desc=a b", "--empty="])).toEqual({
			name: "foo",
			desc: "a b",
			empty: "",
		});
	});

	it("忽略非 --key=value 形式的参数", () => {
		expect(parseFlags(["-m", "--monorepo", "positional", "--=x"])).toEqual({});
	});
});

describe("normalizeName", () => {
	it("自动补 koishi-plugin- 前缀", () => {
		expect(normalizeName("foo")).toBe("koishi-plugin-foo");
		expect(normalizeName("Foo")).toBe("koishi-plugin-foo");
	});

	it("已带前缀 / scope 名原样通过", () => {
		expect(normalizeName("koishi-plugin-foo")).toBe("koishi-plugin-foo");
		expect(normalizeName("@scope/foo")).toBe("@scope/koishi-plugin-foo");
		expect(normalizeName("@scope/koishi-plugin-foo")).toBe(
			"@scope/koishi-plugin-foo",
		);
	});

	it("下划线转连字符", () => {
		expect(normalizeName("foo_bar")).toBe("koishi-plugin-foo-bar");
	});

	it("非法名返回 null", () => {
		expect(normalizeName("foo bar")).toBeNull();
		expect(normalizeName("koishi-plugin-")).toBeNull();
		expect(normalizeName("@scope/foo bar")).toBeNull();
		expect(normalizeName("@Bad/foo")).toBe("@bad/koishi-plugin-foo");
		expect(normalizeName("")).toBeNull();
	});
});

describe("deriveDirname", () => {
	it("去前缀与 scope", () => {
		expect(deriveDirname("koishi-plugin-foo")).toBe("foo");
		expect(deriveDirname("@scope/koishi-plugin-foo")).toBe("foo");
	});
});

describe("renderPackageJson", () => {
	const answers = {
		name: "koishi-plugin-demo",
		dirname: "demo",
		desc: "测试插件",
		owner: "Oppenheymu",
	};

	it("单包形态：CJS 产物 + 自封 workspace + koishi peer", () => {
		const manifest = JSON.parse(
			renderPackageJson(
				answers,
				VERSIONS,
				"tester <t@e.st>",
				{ monorepo: false, console: false },
				false,
			),
		) as Record<string, unknown>;
		expect(manifest["name"]).toBe("koishi-plugin-demo");
		expect(manifest["main"]).toBe("lib/index.cjs");
		expect(manifest["type"]).toBe("module");
		expect(manifest["workspaces"]).toEqual(["."]);
		expect(manifest["files"]).toEqual(["lib"]);
		expect(manifest["peerDependencies"]).toEqual({ koishi: "^4.18.11" });
		expect(
			(manifest["scripts"] as Record<string, string>)["release"],
		).toContain("npm publish");
		expect((manifest["repository"] as Record<string, string>)["url"]).toContain(
			"Oppenheymu/koishi-plugin-demo",
		);
		expect(JSON.stringify(manifest)).not.toContain("@@PLUGIN");
	});

	it("console 形态：补 client 依赖与 dist 产物目录", () => {
		const manifest = JSON.parse(
			renderPackageJson(
				answers,
				VERSIONS,
				"",
				{ monorepo: false, console: true },
				false,
			),
		) as Record<string, unknown>;
		expect(manifest["files"]).toEqual(["lib", "dist"]);
		expect(
			(manifest["devDependencies"] as Record<string, string>)[
				"@koishijs/client"
			],
		).toBe("^5.30.4");
		expect(
			(manifest["peerDependencies"] as Record<string, string>)[
				"@koishijs/plugin-console"
			],
		).toBe("^5.30.11");
	});

	it("monorepo 子包：省略 workspaces 与 changesets scripts", () => {
		const manifest = JSON.parse(
			renderPackageJson(
				answers,
				VERSIONS,
				"",
				{ monorepo: true, console: false },
				true,
			),
		) as Record<string, unknown>;
		expect(manifest["workspaces"]).toBeUndefined();
		expect(
			(manifest["scripts"] as Record<string, string>)["changeset"],
		).toBeUndefined();
		expect(
			(manifest["scripts"] as Record<string, string>)["release"],
		).toBeUndefined();
		expect((manifest["scripts"] as Record<string, string>)["build"]).toBe(
			"tsdown",
		);
	});
});
