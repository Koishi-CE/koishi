---
"create-koishi-ce": minor
"@koishi-ce/plugin-market": patch
---

修复 create-koishi-ce 生成全官方生态项目的根本缺陷：默认模板此前直接下载上游官方 @koishijs/boilerplate 解包，产物依赖全是 npm 官方包（koishi / @koishijs/*，559 包），完全绕开 @koishi-ce 再分发生态，且官方 market 在 Bun 下因 get-registry 依赖直接崩溃。默认模板改为内置的纯 @koishi-ce 依赖集（Bun 运行时、预配 registry.koishi.chat 市场镜像源、不预装本仓无再分发的 adapter / database，官方版可后续从市场安装）；--template 保留为远程模板逃生舱。配套新增 @koishi-ce/koishi-shim（版本冻结 4.18.x 线，不随 changesets 演进），模板以 npm alias "koishi": "npm:@koishi-ce/koishi-shim@^4.18.11" 钉住上游裸名——上游官方插件与社区 koishi-plugin-* 的 peer `koishi ^4.x` 由此满足，市场安装不再拉入 npm 官方 koishi 形成第二份框架副本。plugin-market：安装清单护栏扩展，npm:@koishi-ce alias 声明与 workspace: 声明同等不可覆盖/删除。
