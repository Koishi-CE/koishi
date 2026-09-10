---
"@koishi-ce/console": patch
"@koishi-ce/core": patch
"@koishi-ce/loader": patch
"@koishi-ce/plugin-hmr": patch
---

Bun 原生化收尾清扫：console 入口/实例随机标识、core shortcut 随机 i18n 键改 crypto.randomUUID（仅唯一性用途，无格式契约）；loader 迁移缺省标识从 6 字符 base36 改 UUID（消灭截断碰撞面，写入用户配置的 `group/<前缀>:<标识>` 键变长，唯一性彻底）；hmr 两处 require.resolve 解析锚点换 Bun.resolveSync（createRequire 本体因需 require 文件保留）。
