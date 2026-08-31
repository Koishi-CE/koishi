# create-koishi-ce

## 1.1.0

### Minor Changes

- 770d611: 修复 create-koishi-ce 生成全官方生态项目的根本缺陷：默认模板此前直接下载上游官方 @koishijs/boilerplate 解包，产物依赖全是 npm 官方包（koishi / @koishijs/*，559 包），完全绕开 @koishi-ce 再分发生态，且官方 market 在 Bun 下因 get-registry 依赖直接崩溃。默认模板改为内置的纯 @koishi-ce 依赖集（Bun 运行时、预配 registry.koishi.chat 市场镜像源、不预装本仓无再分发的 adapter / database，官方版可后续从市场安装）；--template 保留为远程模板逃生舱。配套新增 @koishi-ce/koishi-shim（版本冻结 4.18.x 线，不随 changesets 演进），模板以 npm alias "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11" 钉住上游裸名——上游官方插件与社区 koishi-plugin-* 的 peer `koishi ^4.x` 由此满足，市场安装不再拉入 npm 官方 koishi 形成第二份框架副本。plugin-market：安装清单护栏扩展，npm:@koishi-ce alias 声明与 workspace: 声明同等不可覆盖/删除。

## 1.0.1

### Patch Changes

- cab5689: 修复 `bunx create-koishi-ce` 在 Bun 运行时下 registry 探测崩溃（子进程退出码 1 导致脚手架中断）：既有实现按 user-agent 派生探测命令，bun 场景下执行不存在的 `bun config get registry` 后非 npm 分支直接 reject。现移除 `get-registry` 依赖，改为零子进程的原生探测——依次读环境变量 `npm_config_registry` → 项目 `.npmrc` → 用户 `~/.npmrc`，取首个合法 http(s) 地址，任何一步拿不到都静默回落官方源，探测路径不再可能打断主流程。
