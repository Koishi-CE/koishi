# @koishi-ce/core

## 1.1.2

### Patch Changes

- 0a72b50: 指令的权限判定优先于解析错误的反馈：无权限用户输入带解析错误的指令时提示权限不足，不再向其暴露参数类型等解析细节（upstream: koishijs/koishi#1414）
- c822bfe: session.prompt 回调重载的返回类型补上 undefined（超时 resolve(undefined) 而非抛异常，与无参重载一致；upstream: koishijs/koishi#1516）
- cabaa4d: 消息以元素开头（如表情/图片）时不再触发指令纠错建议，避免元素序列化首段（如 `<face`）与相近指令名误匹配（upstream: koishijs/koishi#1533）
- 3df874b: 修复消息元素位于指令插值内部或之后时被二次解析破坏的问题（元素内容失真或被拆成多个 token，upstream: koishijs/koishi#1541）
- Updated dependencies [f5c05de]
  - @koishi-ce/i18n-utils@1.0.1
  - @koishi-ce/utils@1.0.0

## 1.1.1

### Patch Changes

- 0b68ace: 会话数据并发 get-or-create 撞唯一键改为重查回退
  
  同一事件循环内批量 dispatch 多条同频道消息时，多个会话并发执行 getChannel / getUser 的 check-then-act（先 SELECT 未命中才 INSERT），后到者的 INSERT 撞 channel 表 (id, platform) 或 binding 表 (pid, platform) 唯一键，报 UNIQUE constraint failed 并刷 [W] session 日志（上游 issue koishijs/koishi#1545）。现在创建路径撞错时重查返回既有记录，重查仍未命中才向上抛；不识别错误形态，各驱动的冲突错误一致生效。
- @koishi-ce/utils@1.0.0

## 1.1.0

### Minor Changes

- bac9f1d: i18n: 补齐多语种词典缺口
  
  - console：配置 schema 词典恢复 7 语种（新增 de-DE/en-US/fr-FR/ja-JP/ru-RU/zh-TW，含上游缺失的 head 键段），并在 `.i18n()` 中全部注册
  - core：`internal.invalid-{image,audio,video,file}` 4 个 CE 新增键补齐 de-DE/fr-FR/ja-JP/ru-RU/zh-TW 翻译
  - auth：de-DE/en-US/fr-FR/ja-JP/ru-RU 六个语言文件此前的简体中文占位替换为真翻译
  - bind：全语种补齐 `self-1/self-2` 键；de-DE/fr-FR/ja-JP/ru-RU 的中文占位替换为真翻译
  - inspect：de-DE/fr-FR/ja-JP/ru-RU 的中文占位（及半占位）替换为真翻译
- f66c005: i18n: 清剿存量假翻译并新增词典检查工具
  
  - broadcast / callme / echo / help / hmr / admin / logger / status 及 core 的 prompt-argument、commands.$ 等非中文语种中的上游中文占位全部替换为真翻译（含 ja-JP 残留）
  - 新增 `bun tooling/check-locales.ts`：以 zh-CN 为基准检查全仓词典的键对齐、语种齐全与假翻译（market 等上游再分发目录按约定跳过/豁免），当前零报警

### Patch Changes

- @koishi-ce/utils@1.0.0

## 1.0.1

### Patch Changes

- 4c86c84: 适配依赖类型漂移的存量类型错误：session 的 stripped 计算中，剥离 @ 后空白文本节点改经 `.at()` 读取，绕开 while 条件对 `elements[0]` 的判别收窄（新类型下 shift 不会重置收窄，原 `@ts-expect-error` 失效），运行时行为不变。
- @koishi-ce/utils@1.0.0
