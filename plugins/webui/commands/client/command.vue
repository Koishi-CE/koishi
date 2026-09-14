<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <div class="navigation flex flex-wrap gap-x-4 gap-y-2 my-8">
    <router-link
      class="el-button"
      v-if="store.config && store.packages && command.paths.length"
      :to="'/plugins/' + (command.paths[0] ?? '').replace(/\./, '/')"
    >前往插件</router-link>
    <router-link
      class="el-button"
      v-if="store.locales"
      :to="'/locales/commands/' + command.name.replace(/\./, '/')"
    >前往本地化</router-link>
  </div>

  <div class="mb-8">
    <h2 class="k-schema-header">
      别名设置
      <el-button class="float-right mr-4" @click="(inputName = target = '', inputSource = '')">添加</el-button>
    </h2>
    <table>
      <tr v-for="([name, alias], index) in Object.entries(current.aliases)" :key="name">
        <td class="text-left">
          <span class="alias-name" :class="{ disabled: alias?.filter === false }">{{ name }}</span>
          {{ stringify(alias) ? `(${stringify(alias)})` : '' }}
        </td>
        <td class="text-right">
          <el-button
            v-if="index > 0"
            :disabled="alias?.filter === false"
            @click="setDefault(name)"
          >{{ index > 0 ? '设为默认' : '显示名称' }}</el-button>
          <el-button v-if="alias?.filter !== false" @click="deleteAlias(name)">
            {{ command.initial.aliases[name] ? '禁用' : '删除' }}
          </el-button>
          <el-button v-else @click="recoverAlias(name)">恢复</el-button>
        </td>
      </tr>
    </table>
  </div>

  <k-form
    :schema="schema.config"
    :initial="command.override.config"
    v-model="current.config"
  >
    <template #title>指令设置</template>
  </k-form>

  <template v-for="(option, key) in command.initial.options" :key="key">
    <k-form
      :schema="schema.options[key]"
      :initial="command.override.options[key]"
      v-model="current.options[key]"
    >
      <template #title>选项：{{ option.syntax }}</template>
    </k-form>
  </template>

  <el-dialog
    class="command-alias-dialog"
    destroy-on-close
    v-model="showAliasDialog"
    :title="target ? '编辑别名' : '添加别名'"
    @open="handleOpen"
  >
    <div>
      <el-input
        ref="inputEl"
        :class="{ invalid: invalidName }"
        v-model="inputName"
        @keydown.enter.stop.prevent="onEnter"
        placeholder="请输入别名"
      ></el-input>
    </div>
    <div class="mt-2">
      <el-input
        :class="{ invalid: parsed.error }"
        v-model="inputSource"
        @keydown.enter.stop.prevent="onEnter"
        placeholder="请输入参数 (可选)"
      ></el-input>
    </div>
    <template #footer>
      <el-button @click="showAliasDialog = false">取消</el-button>
      <el-button type="primary" :disabled="invalidName || !!parsed.error" @click="onEnter">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/*
 * 单条指令的配置面板（指令管理页右侧内容区）：
 * - 别名表格（设为默认 / 禁用 / 恢复 / 删除）与「添加别名」对话框（支持实时参数解析预览）；
 * - 指令配置、各选项的 k-form 表单（Schema 由 store 按类型名反查）；
 * - 通过顶部菜单 action 把改动发送回服务端。
 */
import {
	clone,
	type Dict,
	deepEqual,
	pick,
	Schema,
	send,
	store,
	useContext,
	useRpc,
	valueMap,
} from "@koishi-ce/client";
import type { Argv, Command } from "@koishi-ce/koishi";
import type {
	CommandData,
	CommandState,
} from "@koishi-ce/plugin-commands";
import { watchDebounced } from "@vueuse/core";
import { computed, nextTick, ref, watch } from "vue";
import { createSchema } from "./utils";

const ctx = useContext();
const data = useRpc<Dict<CommandData>>();

const props = defineProps<{
	command: CommandData;
}>();

// watch immediate 会在 setup 阶段同步覆盖为真实值，空初值仅用于消除
// 「指令数据未就绪」窗口期的 undefined 分支（各字段均为空语义，渲染等价）
const schema = ref<{
	config: Schema;
	options: Dict<Schema>;
}>({
	config: new Schema({}),
	options: {},
});

const inputEl = ref();
const inputName = ref("");
const inputSource = ref("");
const target = ref<string | null>(null);
const current = ref<CommandState>({
	aliases: {},
	config: {},
	options: {},
});

const showAliasDialog = computed({
	get: () => typeof target.value === "string",
	set: () => (target.value = null),
});

// 指令切换时：反查配置 / 选项的 Schema，并把覆盖态克隆为可编辑的草稿
watch(
	() => props.command,
	(value) => {
		if (!value) return;
		const { initial, override } = value;
		schema.value = {
			config: createSchema("command", initial.config),
			options: valueMap(initial.options, (_, key) => {
				// valueMap 遍历到的键必有对应声明；判空兜底与
				// createSchema 对空值的处理一致，不改变实际行为
				return createSchema(
					"command-option",
					initial.options[key] ?? {},
				);
			}),
		};
		current.value = clone(override);
	},
	{ immediate: true },
);

// 顶部菜单：保存更改（无改动时禁用，改动经深比较判定）
ctx.action("command.update", {
	disabled: () =>
		deepEqual(
			pick(current.value, ["config", "options"] satisfies (
				| "config"
				| "options"
			)[]),
			pick(props.command.override, [
				"config",
				"options",
			] satisfies ("config" | "options")[]),
		),
	action: () =>
		send(
			"command/update",
			props.command.name,
			pick(current.value, ["config", "options"] satisfies (
				| "config"
				| "options"
			)[]),
		),
});

// 把某个别名提到字典最前，使其成为显示名称（首项即显示名）
function setDefault(name: string) {
	const item = current.value.aliases[name];
	// 调用方（别名表格行）保证 name 存在于当前别名表，判空仅为类型收窄
	if (!item) return;
	current.value.aliases = {
		[name]: item,
		...current.value.aliases,
	};
	void send(
		"command/aliases",
		props.command.name,
		current.value.aliases,
	);
}

// 删除别名：初始就有的别名改为置 filter=false（禁用），后续新增的直接移除
function deleteAlias(name: string) {
	if (props.command.initial.aliases[name]) {
		const alias = current.value.aliases[name];
		// 禁用仅在别名仍存在于当前表时才有意义，判空仅为类型收窄
		if (alias) alias.filter = false;
	} else {
		delete current.value.aliases[name];
	}
	void send(
		"command/aliases",
		props.command.name,
		current.value.aliases,
	);
}

// 恢复被禁用的初始别名
function recoverAlias(name: string) {
	const alias = props.command.initial.aliases[name];
	// 「恢复」按钮只对初始就有的别名出现，判空仅为类型收窄
	if (!alias) return;
	current.value.aliases[name] = alias;
	void send(
		"command/aliases",
		props.command.name,
		current.value.aliases,
	);
}

// 把别名携带的参数 / 选项还原成可读文本（如 "--foo=bar baz"）
function stringify(alias: Command.Alias) {
	return [
		...(alias?.args || []),
		...Object.entries(alias?.options || {}).map(
			([key, value]) => {
				return value === true
					? `--${key}`
					: `--${key}=${value}`;
			},
		),
	].join(" ");
}

async function handleOpen() {
	// https://github.com/element-plus/element-plus/issues/15250
	// 对话框挂载后需等一个 tick 才能拿到输入框焦点
	await nextTick();
	inputEl.value?.focus();
}

// 全部指令已使用的别名集合（用于重名校验）
const aliases = computed(() => {
	return Object.values(data.value).flatMap(
		(command) => command.override.aliases,
	);
});

// 新别名为空或与现有别名冲突时无效
const invalidName = computed(() => {
	// TODO(疑似 bug)：aliases 是「每指令一份的别名字典」拼成的数组，此处以
	// 字符串直接索引数组恒得 undefined，重名检测实际未生效；按约定不改
	// 运行时行为，以 Reflect.get 忠实复刻原「字符串索引数组」的语义
	// （二者完全等价）并通过类型检查，待定夺后在类型与行为上一并修正
	return (
		!inputName.value ||
		!!Reflect.get(aliases.value, inputName.value)
	);
});

// 服务端解析「别名参数」输入的实时结果（含 error 字段供校验）
const parsed = ref<Argv>({});

// 输入防抖 500ms 后请求服务端解析参数文本，用于实时预览
watchDebounced(
	inputSource,
	async (value) => {
		if (!value.trim()) return;
		parsed.value = await send(
			"command/parse",
			props.command.name,
			inputSource.value,
		);
	},
	{ debounce: 500 },
);

// 确认添加别名：参数文本解析成功则连同解析结果一并存入，否则存空别名
async function onEnter() {
	if (invalidName.value) return;
	if (inputSource.value.trim()) {
		const alias = await send(
			"command/parse",
			props.command.name,
			inputSource.value,
		);
		if (alias.error) return;
		// as 理由：服务端 command/parse 的返回（Argv）在此直接作为别名载荷
		// 存入（消费方只用其 args / options 字段），类型上按 Command.Alias 收纳
		current.value.aliases[inputName.value] =
			alias as Command.Alias;
	} else {
		current.value.aliases[inputName.value] = {};
	}
	await send(
		"command/aliases",
		props.command.name,
		current.value.aliases,
	);
	showAliasDialog.value = false;
	inputSource.value = "";
}
</script>

<style lang="scss" scoped>

.alias-name.disabled {
  text-decoration: line-through;
  color: var(--k-color-disabled);
}

tr {
  transition: var(--color-transition);
}

tr:hover {
  background-color: var(--el-fill-color);
}

</style>
