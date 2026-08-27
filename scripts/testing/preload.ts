// bun test 预载:提供 `import x from '*.yml'`(替代 yml-register 的 require 钩子)
Bun.plugin({
	name: "yml-loader",
	setup(builder) {
		builder.onLoad({ filter: /\.ya?ml$/ }, async (args) => {
			const text = await Bun.file(args.path).text();
			const { load } = await import("js-yaml");
			return {
				contents: `const data = ${JSON.stringify(load(text, {}))};\nexport default data;`,
				loader: "js",
			};
		});
	},
});
