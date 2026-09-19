<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <!-- navigation -->
  <div class="navigation flex flex-wrap gap-x-4 gap-y-2 my-8" v-if="object || showUninstall">
    <a class="el-button" target="_blank"
      v-if="object?.package.links?.['homepage']"
      :href="object.package.links['homepage']"
    >插件主页</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links?.['npm'] && local?.package.version"
      :href="object.package.links['npm'] + '/v/' + local.package.version"
    >当前版本：{{ local.package.version }}</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links?.['repository']"
      :href="object.package.links['repository']"
    >存储库</a>
    <a class="el-button" target="_blank"
      v-if="object?.package.links?.['bugs']"
      :href="object.package.links['bugs']"
    >问题反馈</a>
    <!-- 卸载入口:发起态红色危险样式;已暂存移除转「取消卸载」并退掉危险样式 -->
    <el-button
      v-if="showUninstall"
      :type="buttonState.danger ? 'danger' : ''"
      :loading="uninstalling"
      :disabled="buttonState.disabled"
      class="uninstall-button"
      @click="onUninstallClick"
    >{{ t(buttonState.mode === "cancel" ? "extensions.uninstall.cancel" : "extensions.uninstall.button") }}</el-button>
  </div>

  <!-- 卸载确认:取消 / 仅卸载 / 卸载并移除配置(探到配置节点才给第三项) -->
  <el-dialog
    v-model="showDialog"
    class="market-uninstall-dialog"
    :title="t('extensions.uninstall.dialogTitle')"
    destroy-on-close
  >
    <p>{{ t("extensions.uninstall.dialogBody", { name: shortName }) }}</p>
    <template #footer>
      <el-button @click="showDialog = false">{{ t("extensions.uninstall.dialogCancel") }}</el-button>
      <el-button type="primary" :loading="uninstalling" @click="confirmUninstall(false)">{{ t("extensions.uninstall.only") }}</el-button>
      <el-button v-if="hasConfigEntries" type="danger" :loading="uninstalling" @click="confirmUninstall(true)">{{ t("extensions.uninstall.withConfig") }}</el-button>
    </template>
  </el-dialog>

  <!-- latest -->
  <k-comment v-if="hasUpdate(name) && !global.static">
    <p>当前的插件版本不是最新，<router-link to="/dependencies">点击前往依赖管理</router-link>。</p>
  </k-comment>

  <!-- deprecated -->
  <k-comment v-if="dep?.resolved && versions?.[dep.resolved]?.deprecated" type="danger">
    <p>此版本已废弃，请尽快迁移：{{ versions[dep.resolved]?.deprecated }}</p>
  </k-comment>

  <!-- external -->
  <!-- TODO 人工复核：local 缺失（包不在本地列表）时点击会发送空版本（即卸载语义），
       原代码此处直接空引用崩溃，兜底值 "" 只是权宜，理想行为应是装最新版或隐藏按钮 -->
  <k-comment type="warning" v-if="!local?.workspace && store.dependencies && !store.dependencies[name]">
    <p>尚未将当前插件列入依赖，<span class="k-link" @click="send('market/install', { [name]: local?.package.version ?? '' })">点击添加</span>。</p>
  </k-comment>
</template>

<script lang="ts" setup>
import {
	global,
	message,
	send,
	store,
	useConfig,
	useContext,
} from "@koishi-ce/client";
import type {} from "@koishi-ce/plugin-config";
import {
	type ComputedRef,
	computed,
	inject,
	ref,
} from "vue";
import { useI18n } from "vue-i18n";
import {
	type InstallTexts,
	install,
} from "../components/utils";
import { decodeOverrideEntry } from "../dependencies/dependency-helpers.ts";
import { hasUpdate } from "../utils";
import {
	buildUninstallPayload,
	cancelRemoval,
	resolveButtonState,
	stageRemoval,
} from "./uninstall.ts";

// inject 失败时回退空名，各查询均落空、区块整体不渲染
const name =
	inject<ComputedRef<string>>("plugin:name") ??
	computed(() => "");

const local = computed(() => store.packages?.[name.value]);
const object = computed(
	() => store.market?.data?.[name.value],
);
const dep = computed(
	() => store.dependencies?.[name.value],
);
const versions = computed(
	() => store.registry?.[name.value],
);

const ctx = useContext();
const config = useConfig();
const { t } = useI18n();

/** 卸载执行中(按钮 loading,入口点击与对话框动作全部闭锁)。 */
const uninstalling = ref(false);
const showDialog = ref(false);

/** 宿主运行所必需的依赖(webui 骨架),不提供卸载入口。 */
const PROTECTED_DEPS = new Set([
	"@koishi-ce/plugin-console",
	"@koishi-ce/plugin-config",
	"@koishi-ce/plugin-server",
]);

/** 展示用的短名(剥插件前缀,编解码规则与依赖页一致)。 */
const shortName = computed(() =>
	name.value.replace(
		/(koishi-|^@(?:koishijs|koishi-ce)\/)plugin-/,
		"",
	),
);

/** 该包已暂存移除(override 值为空串,与依赖页同一解码)。 */
const pendingRemove = computed(
	() =>
		decodeOverrideEntry(
			config.value.market.override?.[name.value],
		)?.type === "remove",
);

/** 发起态要求有安装记录(依赖表条目或本地包);已暂存移除恒可撤销。 */
const showUninstall = computed(() => {
	if (global.static || PROTECTED_DEPS.has(name.value))
		return false;
	if (local.value?.workspace || dep.value?.workspace)
		return false;
	if (pendingRemove.value) return true;
	if (store.dependencies) return !!dep.value;
	return !!local.value;
});

const buttonState = computed(() =>
	resolveButtonState(
		pendingRemove.value,
		uninstalling.value,
	),
);

/** 探测该包的配置节点:移除与查询走 configWriter 同一套查找,查不到时移除是静默空操作,故查不到就不给该选项。 */
const hasConfigEntries = computed(
	() => !!ctx.configWriter?.get(name.value)?.length,
);

/** 按钮分流:已暂存移除时点击 = 撤销暂存;否则弹确认对话框。 */
function onUninstallClick() {
	if (uninstalling.value) return;
	if (pendingRemove.value) {
		cancelRemoval(
			config.value.market.override ?? {},
			name.value,
		);
		message.success(t("extensions.uninstall.cancelled"));
		return;
	}
	showDialog.value = true;
}

/**
 * 确认卸载:向 override 暂存区写入移除标记(依赖页 pending 态即刻
 * 可见)后以单包载荷走既有安装链;「卸载并移除配置」在其成功回调里
 * 走 configWriter 既有移除能力。安装失败时暂存残留,按钮转「取消
 * 卸载」供撤销。
 */
async function confirmUninstall(withConfig: boolean) {
	if (!name.value || uninstalling.value) return;
	showDialog.value = false;
	uninstalling.value = true;
	try {
		const override = (config.value.market.override ??= {});
		stageRemoval(override, name.value);
		const texts: InstallTexts = {
			loading: t("extensions.uninstall.progress"),
			success: t("extensions.uninstall.successToast"),
			error: t("extensions.uninstall.failedToast"),
			timeout: t("extensions.uninstall.timeoutToast"),
		};
		await install(
			buildUninstallPayload(name.value),
			async () => {
				if (withConfig)
					ctx.configWriter?.remove(name.value);
			},
			undefined,
			texts,
		);
	} finally {
		uninstalling.value = false;
	}
}
</script>

<style lang="scss" scoped>

</style>
