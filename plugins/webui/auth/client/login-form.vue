<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <div class="login-form text-center">
    <template v-if="user">
      <h1 v-if="store.user"><span>平台账户绑定</span></h1>
      <h1 v-else><span>平台账户登录</span></h1>
      <p class="hint">欢迎你，{{ user.name || 'Koishi 用户' }}！</p>
      <p class="hint">请用上述账号将下面的验证码发送给任意正在运行的机器人</p>
      <p class="token">{{ user.token }}</p>
      <div class="control">
        <k-button @click="user.token = null">返回上一步</k-button>
      </div>
    </template>

    <template v-else>
      <h1 v-if="store.user"><span>平台账户绑定</span></h1>
      <h1 v-else>
        <k-tab :data="['用户密码登录', '平台账户登录']" v-model="shared.authType"></k-tab>
      </h1>

      <template v-if="store.user || shared.authType === 1">
        <el-input placeholder="平台名" v-model="shared.platform">
          <template #prefix>
            <k-icon name="at"></k-icon>
          </template>
        </el-input>
        <el-input placeholder="账号" v-model="shared.userId" @keypress.enter.stop="loginWithAccount">
          <template #prefix>
            <k-icon name="user"></k-icon>
          </template>
        </el-input>
        <p class="error" v-if="error">{{ error }}</p>
        <div class="control">
          <k-button @click="goBack">返回</k-button>
          <k-button @click="loginWithAccount">获取验证码</k-button>
        </div>
      </template>

      <template v-else>
        <el-input placeholder="用户名" v-model="shared.name">
          <template #prefix>
            <k-icon name="user"></k-icon>
          </template>
        </el-input>
        <el-input placeholder="密码" v-model="shared.password" @keypress.enter.stop="loginWithPassword"
          :type="showPassword ? 'text' : 'password'">
          <template #prefix><k-icon name="lock"></k-icon></template>
          <template #suffix>
            <k-icon :name="showPassword ? 'eye' : 'eye-slash'" @click="showPassword = !showPassword"></k-icon>
          </template>
        </el-input>
        <p class="error" v-if="error">{{ error }}</p>
        <div class="control">
          <k-button @click="goBack">返回</k-button>
          <k-button @click="loginWithPassword">登录</k-button>
        </div>
      </template>
    </template>
  </div>
</template>

<script lang="ts" setup>
/**
 * 登录表单：用户密码 / 平台验证码两种方式（k-tab 切换）。
 * 未登录用于登录；已登录时兼作"绑定平台账户"表单（隐藏方式切换）。
 * 平台验证码分两步：先向服务端索取验证码，用户把它发给任意机器人完成验证。
 */
import { send, store } from "@koishi-ce/client";
import type { UserLogin } from "@koishi-ce/plugin-auth";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { shared, showLoginDialog } from "./utils";

const error = ref<string>();
const user = ref<UserLogin>(); // 平台登录第二步：服务端返回的验证码信息
const showPassword = ref<boolean>(false);

let timestamp = 0; // 获取验证码的节流时间戳（1 秒内只允许一次）

/** 发起平台账户登录：向服务端索取一次性验证码并进入第二步。 */
async function loginWithAccount() {
	const now = Date.now();
	if (now < timestamp) return;
	const { platform, userId } = shared.value;
	if (!platform || !userId) return;
	timestamp = now + 1000;
	try {
		user.value = await send("login/platform", platform, userId);
	} catch (e) {
		error.value = e.message;
	}
}

/** 用户密码登录：成功后由 store.user 的 watch 接管跳转。 */
async function loginWithPassword() {
	const { name, password } = shared.value;
	try {
		await send("login/password", name, password);
	} catch (e) {
		error.value = e.message;
	}
}

const router = useRouter();

/** 返回：绑定场景（已登录）关闭对话框，登录场景路由回退。 */
function goBack() {
	if (store.user) {
		showLoginDialog.value = false;
	} else {
		router.back();
	}
}
</script>

<style lang="scss">

.login-form {
  h1 {
    font-size: 1.5rem;
    margin: 2.5rem auto;
    cursor: default;
  }

  .token {
    font-weight: bold;
  }

  .el-input {
    display: block;
    margin: 1rem auto;
  }

  .el-input__wrapper {
    width: 400px;
  }

  .control {
    margin: 2.5rem auto;
  }

  .k-button {
    width: 8rem;
    margin: 0 1rem;
  }
}

</style>
