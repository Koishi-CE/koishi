// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

import type { Plugin } from "vite";

/**
 * .yml/.yaml 鈫?JS 妯″潡鐨?vite 杞崲鎻掍欢锛堟浛浠?@maikolib/vite-plugin-yaml锛夈€? *
 * 鏋勫缓鑴氭湰缁熶竴浠?Bun 鎵ц锛孻AML 瑙ｆ瀽璧?Bun 鍐呯疆鐨?Bun.YAML锛屼笉鍐嶅紩鍏?js-yaml
 * 锛堝叾 4.1.0 鐗堟湰瀛樺湪 GHSA-52cp-r559-cp3m / GHSA-5p4m-2wfm-xmqj 楂樺嵄閫氬憡锛夈€? * 琛屼负瀵归綈鍘熸彃浠讹細榛樿瀵煎嚭瑙ｆ瀽缁撴灉锛屼笉浜у嚭 sourcemap 鏄犲皠銆? */
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
