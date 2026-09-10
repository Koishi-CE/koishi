---
"@koishi-ce/plugin-market": patch
---

节点侧 installer 服务按职责拆分为 `src/node/installer/` 子目录，入口只保留服务本体（缓存、依赖汇总、安装编排与重载判定）：`manifest.ts`（项目根 package.json 读写与护栏判定）、`versions.ts`（远端版本探测与兼容性过滤）、`exec.ts`（bun 安装子进程驱动与输出转发）、`integrity.ts`（安装完整性校验）、`registry-config.ts`（本机 npm registry 配置探测）、`proc.ts`（子进程创建封装）。原 `src/node/installer.ts` 迁移为 `src/node/installer/index.ts`。纯内部结构调整：installer 服务的对外方法与缓存字段（`install` / `override` / `exec` / `getDeps` / `resolveName` / `findVersion` / `fullCache` 等）形状不变，运行时产物行为零变化。
