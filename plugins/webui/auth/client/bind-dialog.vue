<template>
  <!-- 绑定平台账户对话框：已登录状态下从个人资料页唤起，内嵌登录表单 -->
  <el-dialog center v-model="showLoginDialog" class="bind-dialog">
    <login-form></login-form>
  </el-dialog>
</template>

<script lang="ts" setup>
import LoginForm from "./login-form.vue";
import { showLoginDialog } from "./utils";
</script>

<style lang="scss">

</style>
