---
"@koishi-ce/plugin-market": patch
---

依赖收敛：gravatar 头像摘要由 `spark-md5` 换成 `@noble/hashes` 的同步 MD5
（`@noble/hashes/legacy.js`），手写的 `spark-md5.d.ts` 环境声明随之出仓，market
前端产物 172,662 → 168,650 B（-4,012 B）。

`spark-md5` 是 2018 年后不再发布的 UMD 包且不带类型，而 `@noble/hashes` 零依赖、
原生 TS + ESM，本仓早已因 `@paralleldrive/cuid2` 把它带在依赖树里；名数 1 换 1
不变，声明位置仍是本插件的 devDependencies（产物由宿主构建期打包）。

**刻意保留 MD5、不换 SHA-256**：gravatar 官方对 md5 / sha256 双支持（`s.gravatar.com`
两者均返回同一张头像），但镜像不保证——`cravatar.cn`（create-koishi 模板里
`GRAVATAR_MIRROR` 的默认值）对同一邮箱 `md5 → 200` / `sha256 → 404`，换算法会让默认
镜像下的头像全部静默回落默认图。另：客户端必须同步计算，`crypto.subtle` 只在安全
上下文存在，局域网 HTTP 下为 `undefined`。

等价性以 10 组输入（空串 / ASCII / 大小写 / 非 ASCII / 代理对 emoji / 长串 / 首尾
空格）逐条比对，源码级与 `bun build --target=browser` 交付形态双重复核一致。
