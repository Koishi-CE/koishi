/**
 * @file 本地包(.tgz)上传与安装的组合式状态机(pages/dependencies 域)。
 *
 * 由 manual.vue 消费,驱动 local-package-upload.vue 的展示。上传分四步
 * RPC:local-package-upload-start(登记,返回 uploadId 与分块大小)→
 * local-package-upload-chunk(逐块 base64 上传并回报进度)→
 * local-package-upload-finish(服务端解包预检,返回预览)→
 * local-package-upload-commit(确认安装)。commit 成功后用返回的
 * name/request 走 shared/operations 的 install()(forced,绕过版本比较)。
 *
 * 关键设计:自增 uploadGeneration 作废旧流程——用户中途换文件或重置时,
 * 在途分块请求的响应按代数丢弃,并自动调 cancel 上报服务端清理。
 */

import { message, send } from "@koishi-ce/client";
import type {
	LocalPackageUploadCommitResult,
	LocalPackageUploadPreview,
	LocalPackageUploadStartResult,
} from "@koishi-ce/plugin-marketn";
import { Binary } from "cosmokit";
import { computed, onScopeDispose, ref } from "vue";
import { install } from "../../shared/operations";

/** i18n 翻译函数的最小签名(由调用方传入,组合式自身不依赖具体 i18n 实现)。 */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * 本地包上传组合式:t 为文案翻译,closeDialog 在 commit 成功、即将开始
 * 安装时调用(此时进度面板会接管界面)。
 */
export function useLocalPackageUpload(t: Translate, closeDialog: () => void) {
	/** 上传中 / 提交安装中标记(busy = 二者任一)。 */
	const uploading = ref(false);
	const committing = ref(false);
	/** 上传进度:百分比与已收字节数。 */
	const uploadProgress = ref(0);
	const uploadedBytes = ref(0);
	/** 所选文件名与大小。 */
	const selectedSize = ref(0);
	const selectedFilename = ref("");
	/** 服务端分配的上传会话 id(空串表示无在途会话)。 */
	const uploadId = ref("");
	/** 上传/提交过程的错误文案。 */
	const uploadError = ref("");
	/** finish 阶段返回的预检预览(包名/版本/哈希/安装脚本等)。 */
	const preview = ref<LocalPackageUploadPreview>();
	/** 上传流程代数号:每次新上传或 reset 自增,旧流程的响应按代数丢弃。 */
	let uploadGeneration = 0;

	/** 对话框交互锁:上传或提交进行中禁止切换页签/关闭。 */
	const busy = computed(() => uploading.value || committing.value);
	/** 确认按钮文案:无预览时"安装本地包",有预览时按操作类型(安装/更新)+ 版本。 */
	const confirmText = computed(() => {
		if (!preview.value) return t("operations.manual.installLocal");
		return t(`operations.manual.confirmOperation.${preview.value.operation}`, {
			version: preview.value.version,
		});
	});

	/**
	 * 上传主流程:校验 .tgz 后走 start → 逐 chunk(base64) → finish 三段 RPC。
	 * 每一步响应回来都校验 generation,过期则中止(必要时调 cancel 清理
	 * 服务端会话);失败记录错误文案并取消在途会话。
	 */
	// 三段 RPC 分块上传状态机:每步响应都要校验 generation 作废旧流程,拆分会打散时序守卫
	// fallow-ignore-next-line complexity
	async function uploadFile(file: File) {
		if (!file.name.toLowerCase().endsWith(".tgz")) {
			uploadError.value = t("operations.manual.invalidFile");
			return;
		}

		await reset(true);
		const generation = ++uploadGeneration;
		uploading.value = true;
		selectedFilename.value = file.name;
		selectedSize.value = file.size;
		uploadError.value = "";

		try {
			const started = (await send("market/local-package-upload-start", {
				filename: file.name,
				size: file.size,
			})) as LocalPackageUploadStartResult;
			if (generation !== uploadGeneration) {
				void cancelUpload(started.uploadId);
				return;
			}
			uploadId.value = started.uploadId;

			let index = 0;
			for (let offset = 0; offset < file.size; offset += started.chunkSize) {
				if (generation !== uploadGeneration) return;
				const chunk = await file
					.slice(offset, Math.min(file.size, offset + started.chunkSize))
					.arrayBuffer();
				const progress = await send("market/local-package-upload-chunk", {
					uploadId: started.uploadId,
					index,
					data: Binary.toBase64(chunk),
				});
				if (generation !== uploadGeneration) return;
				uploadedBytes.value = progress.received;
				uploadProgress.value = Math.min(
					100,
					Math.round((progress.received / progress.size) * 100),
				);
				index++;
			}

			const result = (await send("market/local-package-upload-finish", {
				uploadId: started.uploadId,
			})) as LocalPackageUploadPreview;
			if (generation !== uploadGeneration) return;
			preview.value = result;
			uploadProgress.value = 100;
		} catch (error) {
			if (generation !== uploadGeneration) return;
			uploadError.value = formatError(
				error,
				t("operations.manual.uploadFailed"),
			);
			const current = uploadId.value;
			uploadId.value = "";
			if (current) void cancelUpload(current);
		} finally {
			if (generation === uploadGeneration) uploading.value = false;
		}
	}

	/**
	 * 确认安装:commit 上传会话(服务端把包落盘),成功后关窗并用返回的
	 * name/request 走 install()(forced=true,按本地包版本强制安装)。
	 */
	async function installPackage() {
		const current = preview.value;
		if (!current || committing.value) return;
		committing.value = true;
		uploadError.value = "";
		try {
			const prepared = (await send(
				"market/local-package-upload-commit",
				current.uploadId,
			)) as LocalPackageUploadCommitResult;
			uploadId.value = "";
			closeDialog();
			await install({ [prepared.name]: prepared.request }, undefined, true, {
				loadingText: t("operations.manual.installingTitle", {
					name: prepared.name,
				}),
				successText: t("operations.manual.installSuccess", {
					name: prepared.name,
					version: prepared.version,
				}),
				errorText: t("operations.manual.installFailed", {
					name: prepared.name,
				}),
			});
		} catch (error) {
			uploadError.value = formatError(
				error,
				t("operations.manual.uploadFailed"),
			);
			message.error(uploadError.value);
		} finally {
			committing.value = false;
		}
	}

	/** 整体复位:世代号 +1 作废在途流程,清空全部本地状态;cancel=true 时上报服务端取消会话。 */
	async function reset(cancel = true) {
		uploadGeneration++;
		const current = uploadId.value;
		uploadId.value = "";
		preview.value = undefined;
		uploadError.value = "";
		uploadProgress.value = 0;
		uploadedBytes.value = 0;
		selectedSize.value = 0;
		selectedFilename.value = "";
		uploading.value = false;
		committing.value = false;
		if (cancel && current) await cancelUpload(current);
	}

	/** 供展示组件回写错误文案(如"只能上传单个文件")。 */
	function setError(value: string) {
		uploadError.value = value;
	}

	/** 组件作用域销毁时复位并取消在途上传,防止会话泄漏。 */
	onScopeDispose(() => {
		void reset(true);
	});

	return {
		busy,
		committing,
		confirmText,
		installPackage,
		preview,
		reset,
		selectedFilename,
		selectedSize,
		setError,
		uploadError,
		uploadFile,
		uploadProgress,
		uploadedBytes,
		uploading,
	};
}

/** 请求服务端取消上传会话;取消失败静默(会话有服务端超时兜底)。 */
async function cancelUpload(uploadId: string) {
	await send("market/local-package-upload-cancel", uploadId).catch(() => {});
}

/** 把抛出的错误归一成可展示字符串,失败给兜底文案。 */
function formatError(error: unknown, fallback: string) {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	if (
		error &&
		typeof error === "object" &&
		typeof (error as any).message === "string"
	) {
		return (error as any).message;
	}
	return fallback;
}
