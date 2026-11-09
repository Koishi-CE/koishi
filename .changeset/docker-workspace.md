---
"create-koishi-ce": minor
"@koishi-ce/koishi": patch
---

### create-koishi-ce

- 新增 `--docker`：按需生成 `Dockerfile`、`docker-entrypoint.sh`、`compose.yaml` 与 `.dockerignore`。采用可变工作区模式——容器内可在控制台插件市场安装 / 卸载 / 更新插件，`koishi.yml`、`package.json`、`bun.lock`、`node_modules` 与 `data/` 写回宿主目录，重启或重建容器不丢失。
- 模板 `koishi.yml` 的 `server.host` 改为 `${{ env.KOISHI_HOST ?? '127.0.0.1' }}`：默认行为不变（仅本机监听），容器内设 `KOISHI_HOST=0.0.0.0` 才能被端口映射访问。
- 模板 `console.open` 改为环境变量插值，并按字面比较 `'0'` / `'false'`（字符串 `"0"` 在 JS 中为真值），无浏览器环境设 `KOISHI_CONSOLE_OPEN=0` 关闭自动打开。
- 模板 README 增加容器部署章节：目录级挂载（禁止单文件挂载 `koishi.yml`）、端口与时区、权限、锁文件、缓存卷、命名卷模式与备份。

### @koishi-ce/koishi

- CLI 父进程现在把 `SIGTERM` / `SIGINT` 转发给 worker，并在收到停止信号后无条件跟随退出（不再触发 daemon 的自动重启）。容器内父进程即 PID 1，这是 `docker stop` 能干净退出的前提；本地 Ctrl+C 的重复信号由 worker 侧 daemon 幂等处理。
