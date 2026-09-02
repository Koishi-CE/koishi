---
"create-koishi-ce": patch
---

refactor(create): 移除 yargs-parser 与自研 tar 解析，命令行与模板解包改用社区包 / 标准工具

- 命令行解析换用 `node:util` 的 `parseArgs`（Bun 内置同一 API），移除 `yargs-parser` 与 `@types/yargs-parser`；未知选项由静默忽略改为明确报错
- 远程模板解包改用 `giget`（其解压实现内联打包 `tar`，零传递依赖）：tarball 先落本地缓存再解压到目标目录，按 npm tarball 惯例剥离顶层 `package/` 目录，自带路径穿越防护；不再维护自研 ustar / pax 解析
- 原自研 tar 的打包侧（`tarPack`）保留为测试专用 fixture 构造器（`src/__tests__/tar-pack.ts`），随附数字字段与 pax 头兼容修复（对齐 node-tar 解析约定）；相应单测收敛到 run-remote 端到端用例
