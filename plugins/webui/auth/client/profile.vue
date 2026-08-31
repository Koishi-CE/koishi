<template>
  <k-layout main="page-profile" :menu="menu">
    <k-content>
      <k-form :schema="schema" v-model="diff"></k-form>

      <h2 class="k-schema-header">
        平台绑定
        <el-button solid class="right" @click="showLoginDialog = true">添加</el-button>
      </h2>
      <div class="k-schema-item" v-for="({ platform, pid, bid }) in store.user.bindings" :key="`${platform}:${pid}`">
        <div class="header">
          <div class="left">{{ platform }} ({{ pid }})</div>
          <div class="right">
            <el-button
              v-if="original.length > 1 || bid !== store.user.id"
              @click.stop.prevent="send('user/unbind', platform, pid)"
            >解绑</el-button>
          </div>
        </div>
      </div>

      <h2 class="k-schema-header">登录历史</h2>
      <ul>
        <li v-for="({ inc, type, createdAt, lastUsedAt, address, userAgent }) in store.user.tokens" :key="inc">
          <div>登录类型：{{ types[type] }}</div>
          <div>登录时间：{{ createdAt }}</div>
          <div>最后访问：{{ lastUsedAt }}</div>
          <div>IP 地址：{{ address }}</div>
          <div>客户端：{{ userAgent }}</div>
          <div><el-button @click="send('user/delete-token', inc)">移除会话</el-button></div>
        </li>
      </ul>
    </k-content>
  </k-layout>
</template>

<script lang="ts" setup>
/**
 * 个人资料页：基本资料表单（用户名 / 密码）+ 平台绑定列表 + 登录历史。
 * 修改先写入 diff，经右上角"应用更改"统一提交；绑定列表可解绑，
 * 登录历史即 token 会话列表，可逐条移除（登出其它设备）。
 */
import { message, Schema, send, store } from "@koishi-ce/client";
import type { UserUpdate } from "@koishi-ce/plugin-auth";
import { computed, ref } from "vue";
import { shared, showLoginDialog } from "./utils";

// 登录类型 id 到显示名的映射
const types = {
	platform: "平台账户",
	password: "用户密码",
};

// 待提交的资料改动（k-form 按 schema 写入，空对象表示无改动）
const diff = ref<UserUpdate>({});

// 基本资料表单 schema：默认值取本地记住的用户名/密码
const schema = computed(() => {
	const result: Schema<UserUpdate> = Schema.object({
		name: Schema.string().description("用户名").default(shared.value.name),
		password: Schema.string()
			.role("secret")
			.description("密码")
			.default(shared.value.password),
	}).description("基本资料");
	return result;
});

/** 退出登录：清空本地令牌并删除服务端会话。 */
async function logout() {
	store.user = null;
	delete shared.value.id;
	delete shared.value.token;
	delete shared.value.expiredAt;
	return send("user/logout");
}

/** 提交资料修改：成功后同步本地 shared 与 store 中的用户信息。 */
async function update() {
	try {
		await send("user/update", diff.value);
		message.success("修改成功！");
		Object.assign(shared.value, diff.value);
		Object.assign(store.user, diff.value);
		diff.value = {};
	} catch (e) {
		message.error(e.message);
	}
}

// 本账号"自身"的绑定（bid === 自身 id）：仅剩一个自身绑定时禁止解绑
const original = computed(() => {
	return store.user?.bindings.filter((item) => store.user.id === item.bid);
});

// 右上角操作菜单：应用资料修改 / 退出登录
const menu = computed(() => [
	{
		icon: "check",
		label: "应用更改",
		disabled: !diff.value || !Object.keys(diff.value).length,
		action: update,
	},
	{
		type: "danger",
		icon: "sign-out",
		label: "退出登录",
		action: logout,
	},
]);
</script>

<style lang="scss">

.page-profile {
  h1 {
    font-size: 1.375rem;
    margin: 1.5rem 0;
    line-height: 2rem;
  }

  .el-button.right {
    float: right;
  }
}

</style>
