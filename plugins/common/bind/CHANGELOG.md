# @koishi-ce/plugin-bind

## 1.1.0

### Minor Changes

- bac9f1d: i18n: 补齐多语种词典缺口
  
  - console：配置 schema 词典恢复 7 语种（新增 de-DE/en-US/fr-FR/ja-JP/ru-RU/zh-TW，含上游缺失的 head 键段），并在 `.i18n()` 中全部注册
  - core：`internal.invalid-{image,audio,video,file}` 4 个 CE 新增键补齐 de-DE/fr-FR/ja-JP/ru-RU/zh-TW 翻译
  - auth：de-DE/en-US/fr-FR/ja-JP/ru-RU 六个语言文件此前的简体中文占位替换为真翻译
  - bind：全语种补齐 `self-1/self-2` 键；de-DE/fr-FR/ja-JP/ru-RU 的中文占位替换为真翻译
  - inspect：de-DE/fr-FR/ja-JP/ru-RU 的中文占位（及半占位）替换为真翻译

### Patch Changes

- @koishi-ce/koishi@1.0.8
