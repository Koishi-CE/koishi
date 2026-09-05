---
"create-koishi-ce": minor
---

内置模板的 scripts 补齐插件开发全链入口：新增 `clone`（克隆插件仓库到 `external/`）、`build`（串行构建 `external/`）、`release:version` / `release:dryrun` / `release`（changeset 消费 → 构建 → npm 发布三环，均为 `koishi-scripts` 子命令）；模板 README 同步修正 `new` 的实际落点（`external/` 而非 `plugins/`）并补构建发布说明。
