---
"@koishi-ce/plugin-auth": patch
---

登录令牌与平台验证码改用 CSPRNG 生成：randomId 以 randomBytes 拒绝采样替代 Math.random（40 位格式契约不变，熵从约 66 位提升到约 238 位）；6 位登录验证码改 randomInt 固定 6 位数字（原实现在小数串过短时不足 6 位且非 CSPRNG）。
