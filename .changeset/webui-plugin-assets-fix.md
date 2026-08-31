---
"@koishi-ce/plugin-console": patch
"@koishi-ce/client": patch
---

fix(webui): 修复生产环境插件前端产物服务链路，存量插件包免升级恢复样式与功能

生产环境（npm 安装形态）下 webui 插件前端大面积崩坏，根因与修复：

- **插件样式未下发**：`resolveEntry` 只探测 `dist/style.css`，而存量 1.0.0 插件包的样式产物名为 `index.css`（css 改名约定未随其重新发布），导致 sandbox / explorer / insight / commands / status 等十个插件无样式——表现为图标偏小、状态栏悬停弹层呈黑色矩形、沙盒页面崩坏。现按 `style.css` → `index.css` 双名兼容探测，旧包直接恢复。
- **裸导入改写漏形态**：`transformImport` 只匹配 `import … from` 形态，logger 产物的副作用导入 `import"vue-router"` 不被改写，浏览器以裸名解析失败导致整个插件模块不加载（页面路由不注册）。重写为覆盖静态导入 / 副作用导入 / 再导出 / 动态导入四种形态，并增加前导语句边界约束（避免误伤字符串字面量中的同类文案）；映射表补 `@koishijs/client`（市场安装的上游官方 webui 插件复用同一份宿主 client chunk）。
- **worker 请求 404 回退 HTML**：monaco 产物以根绝对路径引用 worker（`/editor.worker-*.js`），不带 `@plugin-` 前缀落到主体分支，未命中时 SPA 兜底返回 index.html，浏览器报 `Unexpected token '<'` 且 monaco 降级主线程。主体分支现按文件名在各 entry 产物目录兜底探测；带扩展名的资源未命中时如实 404，不再回退 HTML。
- **devMode 直出短路**：dev 模式下 npm 安装的插件回退产物 URL 后原样直出裸导入，一并改为统一走改写；entry 声明的源码形态误达 `@plugin` 通道时返回 404。
- **初始导航 no match 警告**（@koishi-ce/client）：loader 的 `initTask` 在入口文件实际加载完成前即 resolve（`Promise.all` 的 map 回调未返回加载任务），router install 早于插件注册路由，直接访问 `/sandbox`、`/graph` 等路径时 vue-router 报 no match。现等待全部入口文件 settle（单个扩展失败仍不阻塞界面）。
