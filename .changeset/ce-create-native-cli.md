---
"create-koishi-ce": patch
---

refactor(create): 移除 yargs-parser 与 tar 依赖，改用 Bun 内置能力

- 命令行解析换用 `node:util` 的 `parseArgs`（Bun 内置同一 API），移除 `yargs-parser` 与 `@types/yargs-parser`；未知选项由静默忽略改为明确报错
- 远程模板解包自研零依赖 tar 解析（`src/tar.ts`：ustar / pax 扩展格式，gzip 走 `node:zlib`，含路径穿越防护），移除 `tar` 依赖；配套新增独立单测
