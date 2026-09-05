# @koishi-ce/plugin-help

## 1.1.0

### Minor Changes

- f66c005: i18n: 清剿存量假翻译并新增词典检查工具
  
  - broadcast / callme / echo / help / hmr / admin / logger / status 及 core 的 prompt-argument、commands.$ 等非中文语种中的上游中文占位全部替换为真翻译（含 ja-JP 残留）
  - 新增 `bun tooling/check-locales.ts`：以 zh-CN 为基准检查全仓词典的键对齐、语种齐全与假翻译（market 等上游再分发目录按约定跳过/豁免），当前零报警

### Patch Changes

- @koishi-ce/koishi@1.0.8
