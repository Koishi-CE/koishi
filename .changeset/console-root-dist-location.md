---
"@koishi-ce/plugin-console": patch
---

修复生产模式下控制台前端根目录定位：构建产物中本模块被 rolldown 拆至 lib/ 一层（lib/node/index.mjs 仅为壳），原先按 import.meta.url 向上两级的写法随 chunk 落点漂移，root 被指到包外导致 index.html 读取失败、webui 白屏；改为按 __dirname（恒为产物文件所在目录）定位 dist，与 market 插件同款。
