<template>
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
