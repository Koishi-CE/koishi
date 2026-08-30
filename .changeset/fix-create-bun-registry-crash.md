---
"create-koishi-ce": patch
---

修复 `bunx create-koishi-ce` 在 Bun 运行时下 registry 探测崩溃（子进程退出码 1 导致脚手架中断）：既有实现按 user-agent 派生探测命令，bun 场景下执行不存在的 `bun config get registry` 后非 npm 分支直接 reject。现移除 `get-registry` 依赖，改为零子进程的原生探测——依次读环境变量 `npm_config_registry` → 项目 `.npmrc` → 用户 `~/.npmrc`，取首个合法 http(s) 地址，任何一步拿不到都静默回落官方源，探测路径不再可能打断主流程。
