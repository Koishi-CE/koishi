<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <!-- 登录页：居中卡片内嵌登录表单 -->
  <k-layout main="darker page-login">
    <k-card>
      <login-form></login-form>
    </k-card>
  </k-layout>
</template>

<script lang="ts" setup>
import LoginForm from "./login-form.vue";
</script>

<style lang="scss">

.page-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.page-login .k-card {
  width: 600px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin: 0;

  .k-card-body {
    padding: 3rem 0 !important;
  }
}

</style>
