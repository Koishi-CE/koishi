<template>
  <k-layout class="page-sandbox">
    <template #left>
      <div class="card-header k-tab-menu-item" @click="createUser">添加用户</div>
      <div class="user-container">
        <el-scrollbar>
          <k-tab-group :data="userMap" v-model="config.user" #="{ name }">
            <div class="avatar">{{ name[0] }}</div>
            <div class="nick">{{ name }}</div>
            <div class="close" @click="removeUser(name)">
              <k-icon name="times-full"></k-icon>
            </div>
          </k-tab-group>
        </el-scrollbar>
      </div>
    </template>

    <div class="card-header">
      <template v-for="(name, key) in panelTypes" :key="key">
        <span class="k-horizontal-tab-item"
          :class="{ active: config.panelType === key }"
          @click="config.panelType = key">{{ name }}</span>
      </template>
    </div>

    <keep-alive>
      <k-empty key="empty" v-if="!users.length">
        <div>点击「添加用户」开始体验</div>
      </k-empty>
      <k-content :key="'profile' + channel" v-else-if="config.panelType === 'profile'">
        <k-form v-if="user" :initial="user" v-model="model" :schema="schema" :show-header="false"></k-form>
      </k-content>
      <template v-else :key="channel">
        <virtual-list :data="config.messages[channel] || []" #="data" pinned>
          <chat-message :data="data"></chat-message>
        </virtual-list>
        <div class="card-footer">
          <div class="quote" v-if="quote">
            <span class="left">正在回复 @{{ quote.user }}</span>
            <k-icon name="times-full" @click="quote = null"></k-icon>
          </div>
          <chat-input v-model="input" @send="sendMessage" @keydown="onKeydown" placeholder="发送消息到沙盒"></chat-input>
        </div>
      </template>
    </keep-alive>
  </k-layout>
</template>

<script lang="ts" setup>
/**
 * 沙盒页面主布局。
 *
 * 左栏管理虚拟用户（创建 / 切换 / 删除，昵称取自 words 候选表）；
 * 顶栏切换私聊 / 群聊 / 用户设置三种面板：
 * - 私聊/群聊：消息虚拟列表 + 输入框（支持引用回复、方向键翻查历史输入）；
 * - 用户设置：k-form 编辑当前用户的权限等级，变更自动写回数据库。
 * 消息的收发通过 utils.ts 的 config / api 与 node 侧 SandboxBot 对接。
 */
import {
	clone,
	deepEqual,
	message,
	Schema,
	send,
	useContext,
	VirtualList,
} from "@koishi-ce/client";
import type { Message } from "@koishi-ce/plugin-sandbox";
import { ChatInput } from "@satorijs/components-vue";
import segment from "@satorijs/element";
import { computed, ref, watch } from "vue";
import ChatMessage from "./message.vue";
import { api, channel, config, panelTypes, words } from "./utils";

const ctx = useContext();

// 消息右键菜单的两项动作:删除消息 / 设为引用回复
ctx.action("sandbox.message.delete", {
	action: ({ sandbox }) => deleteMessage(sandbox.message),
});

ctx.action("sandbox.message.quote", {
	action: ({ sandbox }) => (quote.value = sandbox.message),
});

/** 用户设置表单的 schema：当前仅暴露权限等级字段。 */
const schema = Schema.object({
	authority: Schema.natural().description("权限等级"),
});

/** 已创建的用户列表（从 messages 的 `@` 前缀键提取）。 */
const users = computed(() => {
	return Object.keys(config.value.messages)
		.filter((key) => key.startsWith("@"))
		.map((key) => key.slice(1));
});

/** 左栏用户列表的 k-tab-group 数据源。 */
const userMap = computed(() => {
	return Object.fromEntries(users.value.map((name) => [name, { name }]));
});

const length = 10;

/** 创建用户：按 index 轮询取 words 中未占用的昵称，并通知 node 侧入库。 */
function createUser() {
	if (users.value.length >= length) {
		return message.error("可创建的用户数量已达上限。");
	}
	let name: string;
	do {
		name = words[config.value.index++];
		config.value.index %= length;
	} while (users.value.includes(name));
	config.value.user = name;
	config.value.messages[`@${name}`] = [];
	void send("sandbox/set-user", config.value.platform, config.value.user, {});
}

/** 删除用户：清掉本地消息并通知 node 侧移除数据，被删的是当前用户时切换选中项。 */
function removeUser(name: string) {
	const index = users.value.indexOf(name);
	delete config.value.messages[`@${name}`];
	void send("sandbox/set-user", config.value.platform, config.value.user, null);
	if (config.value.user === name) {
		config.value.user = users.value[index] || "";
	}
}

const input = ref("");
const offset = ref(0);
const quote = ref<Message>();

/**
 * 输入框的历史回溯（终端风格）：
 * ArrowUp 向上翻查当前用户发过的历史消息，ArrowDown 向下返回，
 * offset 记录距最新一条的偏移，超出范围时回到空输入。
 */
function onKeydown(event: KeyboardEvent) {
	if (event.key === "ArrowUp") {
		const list = config.value.messages[channel.value].filter(
			(item) => item.user === config.value.user,
		);
		let index = list.length - offset.value;
		if (list[index - 1]) {
			offset.value++;
			input.value = segment.unescape(list[index - 1].content);
		}
	} else if (event.key === "ArrowDown") {
		const list = config.value.messages[channel.value].filter(
			(item) => item.user === config.value.user,
		);
		let index = list.length - offset.value;
		if (list[index + 1]) {
			offset.value--;
			input.value = segment.unescape(list[index + 1].content);
		} else if (offset.value) {
			offset.value = 0;
			input.value = "";
		}
	}
}

const user = ref();
const model = ref();

// 切换用户时拉取其数据库记录,克隆一份作为表单编辑副本
watch(
	() => config.value.user,
	async (value) => {
		if (!value) return;
		user.value = await send(
			"sandbox/get-user",
			config.value.platform,
			config.value.user,
		);
		model.value = clone(user.value);
	},
	{ immediate: true },
);

// 表单深度变更且与库中记录不一致时,自动写回 node 侧数据库
watch(
	model,
	async (value) => {
		if (deepEqual(value, user.value)) return;
		// biome-ignore lint/nursery/noFloatingPromises: 已在 async 回调中 await，nursery 规则对 .vue 内 send 调用的误报
		await send(
			"sandbox/set-user",
			config.value.platform,
			config.value.user,
			value,
		);
		user.value = clone(value);
	},
	{ deep: true },
);

/** 发送消息：重置历史偏移，携带引用消息发往 node 侧并清空引用状态。 */
function sendMessage(content: string) {
	offset.value = 0;
	void send(
		"sandbox/send-message",
		config.value.platform,
		config.value.user,
		channel.value,
		content,
		quote.value,
	);
	quote.value = null;
}

/** 删除消息：通知 node 侧派发删除事件，并同步移除本地消息列表中的记录。 */
async function deleteMessage(data: Message) {
	// biome-ignore lint/nursery/noFloatingPromises: 已在 async 函数中 await，nursery 规则对 .vue 内 send 调用的误报
	await send(
		"sandbox/delete-message",
		data.platform,
		data.user,
		data.channel,
		data.id,
	);
	api.deleteMessage({ messageId: data.id, channelId: data.channel });
}
</script>

<style lang="scss">

.page-sandbox {
  --avatar-size: 2.5rem;

  aside, main {
    display: flex;
    flex-direction: column;
  }

  .avatar {
    border-radius: 100%;
    background-color: var(--primary);
    transition: 0.3s ease;
    width: var(--avatar-size);
    height: var(--avatar-size);
    line-height: var(--avatar-size);
    font-size: 1.25rem;
    text-align: center;
    font-weight: 400;
    color: #fff;
    font-family: Comic Sans MS;
    user-select: none;
  }

  .card-header {
    text-align: center;
    font-weight: bold;
    font-size: 1.15rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--k-color-divider);
  }

  .card-footer {
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--k-color-divider);

    .quote {
      opacity: 0.5;
      font-size: 14px;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .k-icon {
        cursor: pointer;
      }
    }
  }

  .user-container {
    overflow-y: auto;
  }

  .k-tab-item {
    padding: 0.75rem 1.5rem;
    display: flex;
    border-bottom: 1px solid var(--k-color-divider);

    > .nick {
      line-height: 2.5rem;
      margin-left: 1.25rem;
      font-weight: 500;
      flex-grow: 1;
    }

    > .close {
      opacity: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      transition: opacity 0.3s ease;
      color: var(--fg1);
    }

    &:hover > .close {
      opacity: 0.5;
      &:hover {
        opacity: 1;
      }
    }
  }
}

.message-context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 12rem;
  padding: 0.5rem 0;
  border-radius: 4px;
  background-color: var(--k-card-bg);
  box-shadow: var(--k-card-shadow);
  transition: var(--color-transition);
  font-size: 14px;

  .item {
    user-select: none;
    padding: 0.25rem 1.5rem;
    cursor: pointer;
    transition: var(--color-transition);

    &:hover {
      background-color: var(--k-hover-bg);
    }
  }
}

</style>
