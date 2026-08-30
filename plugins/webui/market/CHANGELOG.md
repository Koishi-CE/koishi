# @koishi-ce/plugin-market

## 1.0.1

### Patch Changes

- 44da00e: 修复 Bun 运行时下 market 服务启动崩溃：移除 get-registry 依赖，registry 探测改原生 npmrc 读取。get-registry 按 user-agent 选 `bun config get registry`，而 Bun 没有 config 子命令，子进程退出码 1 直接抛错打断 webui 加载；新实现按 环境变量 > 项目 .npmrc > 用户 ~/.npmrc 的优先级零子进程读取，与 cab5689 对 create-koishi-ce 的修复同源。
