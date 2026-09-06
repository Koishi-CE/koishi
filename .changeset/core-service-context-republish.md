---
"@koishi-ce/core": patch
---

补发 `getServiceContext()` 服务归属反查导出：

- 0449ee3 消费的 changeset 误将本包写作 `@koishi-ce/koishi`（该 npm 名属 `packages/node/cli` 转导出包），导致携带 5f4dcd2 新增 `getServiceContext()` 的 core 从未发版；已发布的 plugin-config / plugin-insight 因导入该符号，在下游 ESM 链接期失败（启动报两条 app Error，config 配置页与 insight 依赖图不可用）。
- 本条目使 core 真正发版，下游 `bun update` 后即恢复。
