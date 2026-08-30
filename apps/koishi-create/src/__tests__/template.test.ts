import { expect, test } from "bun:test";
import { renderManifest } from "../index.ts";
import { baseManifest, templateFiles } from "../template.ts";

test("内置模板依赖纯度：不含任何 @koishijs / koishi-plugin 官方生态包", () => {
	const { dependencies, devDependencies } = baseManifest();
	for (const key of Object.keys(dependencies ?? {})) {
		// koishi 裸名是刻意的 npm alias 占位，其余必须是 @koishi-ce 作用域
		expect(key === "koishi" || key.startsWith("@koishi-ce/")).toBe(true);
	}
	const toolchain = new Set(["bun-types", "cross-env"]);
	for (const key of Object.keys(devDependencies ?? {})) {
		expect(key.startsWith("@koishi-ce/") || toolchain.has(key)).toBe(true);
	}
});

test("内置模板以 npm alias 钉住 koishi 裸名，版本保持 4.18.x 冻结线", () => {
	const request = baseManifest().dependencies?.["koishi"];
	expect(typeof request).toBe("string");
	// alias 形态 npm:@koishi-ce/koishi-shim@^4.18.x——版本若漂出 ^4 区间，
	// 上游插件的 peer `koishi ^4` 判定为不满足，market UI 会试图改写它
	expect(request ?? "").toMatch(/^npm:@koishi-ce\/koishi-shim@\^4\./);
});

test("内置模板静态文件齐备，koishi.yml 预配 market 镜像源", () => {
	for (const file of [
		".env",
		".gitignore",
		"koishi.yml",
		"tsconfig.json",
		"README.md",
	]) {
		expect(templateFiles[file]?.length ?? 0).toBeGreaterThan(0);
	}
	expect(templateFiles["koishi.yml"]).toContain(
		"endpoint: https://registry.koishi.chat/index.json",
	);
	// 模板不预装数据库，依赖数据库的插件保持 ~ 禁用
	expect(templateFiles["koishi.yml"]).toContain("~analytics");
});

test("renderManifest 渲染内置模板：常规改写生效，prod 模式保留 koishi alias", () => {
	const output = JSON.parse(renderManifest(baseManifest(), "my-app", false));
	expect(output.name).toBe("my-app");
	expect(output.private).toBe(true);
	expect(output.version).toBe("0.0.0");
	expect(output.scripts.start).toBe("koishi start");
	expect(output.dependencies.koishi).toBe(
		"npm:@koishi-ce/koishi-shim@^4.18.11",
	);

	const prod = JSON.parse(renderManifest(baseManifest(), "my-app", true));
	expect("workspaces" in prod).toBe(false);
	expect("devDependencies" in prod).toBe(false);
	// koishi alias 是运行时依赖，prod 模式下必须原样保留
	expect(prod.dependencies.koishi).toBe("npm:@koishi-ce/koishi-shim@^4.18.11");
});
