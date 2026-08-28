import { defineConfig } from "tsdown";

/**
 * loader 的包级构建配置：在根 workspace 配置的基础上补一个 shared 入口。
 *
 * shared 只包含 base/（浏览器可加载的抽象层），供 package.json 的
 * browser 条件与 ./shared 子路径使用；其余选项（ESM、dts、外置
 * @koishi-ce/* 等）沿用根配置。
 */
export default defineConfig({
	entry: ["src/index.ts", "src/shared.ts"],
});
