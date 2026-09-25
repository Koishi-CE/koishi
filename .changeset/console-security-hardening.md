---
"@koishi-ce/plugin-console": patch
---

console 静态资源托管安全加固：

- 主体资源的 403 路径穿越判定删除上游继承的 `includes('node_modules')` 弱放行——该条件允许路径先逃逸出 root 再以磁盘上任意 node_modules 目录为锚放行（如 `/console/../../Other/node_modules/x`），构成越界读文件面；本仓构建管线不产生指向 node_modules 的资源引用，root 外一律 403；
- transformHtml 的 KOISHI_CONFIG 注入把 JSON 中的 `<` 转义为 `\u003c`，防止配置值（uiPath / selfUrl 等）中的 `</script>` 提前闭合 script 标签注入任意 HTML；
- head 注入的 content 按标签语义分派转义（script/style 中和闭合序列、其余标签按实体转义），tag 名以正则白名单校验，非法 tag 整条跳过。
