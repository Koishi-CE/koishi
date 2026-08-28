/**
 * @file 本地依赖绑定确认 composable(dependencies 域)。
 *
 * 确认后向服务端请求 prepare-local-binding 拿到版本请求串,写入待应用
 * override 并持久化;保存失败会回滚本地写入。
 */

import { ref } from "vue";
import { message, send } from "@koishi-ce/client";
import {
	getPendingOverrides,
	patchMarketNextData,
} from "../../shared/plugin-config";

export function useLocalBinding(
	name: string,
	t: (key: string, ...args: any[]) => string,
) {
	const showLocalBindingDialog = ref(false);
	const bindingLocal = ref(false);

	function openLocalBinding() {
		showLocalBindingDialog.value = true;
	}

	async function confirmLocalBinding() {
		if (bindingLocal.value) return;
		bindingLocal.value = true;
		try {
			const result = await send("market/prepare-local-binding", name);
			if (!result?.request) throw new Error("invalid local binding result");
			getPendingOverrides()[name] = result.request;
			const saved = await patchMarketNextData({
				override: { ...getPendingOverrides() },
			});
			if (!saved) {
				delete getPendingOverrides()[name];
				throw new Error("failed to save local binding override");
			}
			showLocalBindingDialog.value = false;
			message.success(t("dependencyCard.localBinding.prepared"));
		} catch (error) {
			console.error(error);
			message.error(t("dependencyCard.localBinding.failed"));
		} finally {
			bindingLocal.value = false;
		}
	}

	return {
		showLocalBindingDialog,
		bindingLocal,
		openLocalBinding,
		confirmLocalBinding,
	};
}
