---
"create-koishi-ce": patch
---

fix: overrides 兜底层补收裸名社区包 `koishi-plugin-puppeteer` → `@koishi-ce/plugin-puppeteer`

CE 以改名包再分发上游裸名社区包时，原包的落盘版本永远满足不了第三方插件的
`koishi-plugin-<名>` 声明，没有归属的 peer 会被包管理器自动装下——CE 宿主里就此凭空
多出官方实现。`koishi-plugin-market-tracker` 的 `peerDependencies` 声明了
`koishi-plugin-puppeteer@^3.9.0`，实测（Bun 1.4.2）该 peer 会被自动装下并连带
`@koishijs/canvas` / `puppeteer-core` / `puppeteer-finder`；CE 侧的实现是
`@koishi-ce/plugin-puppeteer`（同名 `puppeteer` 服务），故按需收录进 overrides。

- `apps/koishi-create`：新增 `RENAMED_COMMUNITY_OVERRIDES` 表（按需收录，收录条件是
  「有第三方插件把该裸名写进 peer / dependencies」），与既有的同名再分发表合并进
  `buildUpstreamOverrides()`，清单 41 → 42 名；
- `tooling/sandbox`：同款清单同步（对账测试防漂移）；
- 文档与测试同步（`packages/shim/README.md` 三层防线、`docs/reference/architecture.md`、
  `AGENTS.md` 铁律 9）。

注意 overrides 会连带静默顶替用户的显式直连声明：实测 Bun 遇到冲突既不报错也不提示
（npm 会抛 EOVERRIDE），即模板项目里装不上官方同名实现——这是 CE 生态的取舍。
