---
"@koishi-ce/plugin-auth": patch
---

移除旧版无盐 SHA-256 密码哈希兼容层：密码校验现仅接受 `pbkdf2$` 格式，登录时命中旧格式存储一律拒绝（不再透明升级改写）。CE 全新安装的密码均为 PBKDF2 格式，此兼容层为上游 Koishi 遗留的不可达代码，且持续触发安全扫描误报（js/insufficient-password-hash）；从官方 Koishi 迁移且沿用旧哈希的管理员账户需重置密码。
