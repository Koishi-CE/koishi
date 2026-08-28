import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/bin.ts", "src/index.ts"],
	format: "cjs",
	dts: true,
	platform: "node",
	outDir: "lib",
	fixedExtension: false,
	clean: true,
});
