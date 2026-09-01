// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

import type { UserConfig } from "tsdown";
import { defineConfig } from "tsdown";

/**
 * @koishi-ce/client 鐨?node 渚ф瀯寤洪厤缃紙workspace 妯″紡涓嬩笌鏍归厤缃悎骞讹紝
 * 鍏朵綑閫夐」娌跨敤鏍归厤缃殑 ESM-only 绾﹀畾锛夈€? *
 * 鐩稿鏍归厤缃殑宸紓浠呮槸澶氬叆鍙ｏ細闄や富鍏ュ彛锛堢紪绋嬪紡 build / createServer锛夊锛? * 杩樿浜у嚭 `koishi-console` CLI锛坰rc/bin.ts锛屼骇鐗╅琛?shebang 鐢?rolldown
 * 鍘熸牱淇濈暀锛宲ackage.json 鐨?bin 瀛楁鎸囧悜瀹冿級銆? */
const config: UserConfig = {
	entry: {
		index: "src/index.ts",
		bin: "src/bin.ts",
	},
};

export default defineConfig([config]);
