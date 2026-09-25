---
"@koishi-ce/scripts": patch
---

fix: 修复 `koishi-scripts version` 在 Bun 工作区（Windows）下找不到 changeset 命令、发布链第一环即中断的问题：changeset 二进制解析只探测 npm / pnpm / yarn 生成的 `.cmd` 批处理 shim，而 Bun 安装生成的 shim 为 `.exe`（bunx 垫片）——两级候选（项目本地 / 工作区根）全部落空后回退 PATH 裸名同样不可达，报「'changeset' is not recognized as an internal or external command」。现按「项目本地 → 工作区根」外层、「.cmd → .exe」内层两级遍历探测，npm 系与 Bun 两种安装形态均可命中，项目本地整体优先的语义不变。
