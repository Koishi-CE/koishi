import type { Plugin } from "vite";

/**
 * .yml/.yaml → JS 模块的 vite 转换插件（替代 @maikolib/vite-plugin-yaml）。
 *
 * 构建脚本统一以 Bun 执行，YAML 解析走 Bun 内置的 Bun.YAML，不再引入 js-yaml
 * （其 4.1.0 版本存在 GHSA-52cp-r559-cp3m / GHSA-5p4m-2wfm-xmqj 高危通告）。
 * 行为对齐原插件：默认导出解析结果，不产出 sourcemap 映射。
 */
export function yaml(): Plugin {
	return {
		name: "vite:transform-yaml",
		transform(code, id) {
			if (!/\.ya?ml$/.test(id)) return null;
			const data = Bun.YAML.parse(code);
			return {
				code: `const data = ${JSON.stringify(data)};\nexport default data;`,
				map: { mappings: "" },
			};
		},
	};
}
