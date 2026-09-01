# @@PKG_NAME@@

[![npm](https://img.shields.io/npm/v/@@PKG_NAME@@?style=flat-square)](https://www.npmjs.com/package/@@PKG_NAME@@)

@@DESC@@

## 开发

```bash
bun install            # 在宿主工作区根目录执行一次（workspace 成员依赖提升）
bun run build          # 根级：--filter 构建全部子包（产物 packages/*/lib/index.cjs）
bun run --filter '@@PKG_NAME@@' check   # 单包门禁：biome + 类型检查
```

约定详见 `AGENTS.md`。
