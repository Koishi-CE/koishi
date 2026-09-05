"@koishi-ce/koishi": patch

---

修复 `koishi start` 在 Windows 下的选项静默失效：Bun.spawn 的默认 env 继承只取进程启动时的 OS 环境快照，运行时经 `process.env` 写入的 `KOISHI_LOG_LEVEL` / `KOISHI_DEBUG` / `KOISHI_LOG_TIME` / `KOISHI_CONFIG_FILE` / `KOISHI_SHARED` 传不到 worker 子进程（`--log-level`、`--debug` 等命令行选项无效、重启后共享环境数据丢失）。现显式展开 `env: { ...process.env }` 传递。
