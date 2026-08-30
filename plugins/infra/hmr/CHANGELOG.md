# @koishi-ce/plugin-hmr

## 1.0.1

### Patch Changes

- a772c44: 修复 Bun 运行时下 webui 长时间转圈无法加载的问题：hmr 的 chokidar 在 win32 上以反斜杠原生路径调用匹配器，glob 形式的 ignored 完全失效，导致巨型 node_modules 被完整遍历（每秒数万条目、持续数分钟），事件循环被 IO 回调风暴挤压，server 的 HTTP 请求 72 秒以上无响应——现将「双星通配包裹目录名」的忽略规则编译为目录段剪枝函数，目录命中即整树剪枝（实测初始扫描从 99 秒未就绪降到 267ms）。另修复 market 两处启动报错：Scanner 构造裸取 registry.get 丢失 this 抛 TypeError（包一层箭头函数保持绑定）；本机 npmrc 无 registry 配置时 endpoint 无默认回落，相对 URL 在 resolveURL 抛 Invalid URL（回落 npm 官方源，对齐被移除的 get-registry 默认值）。
- Updated dependencies [c9f7ef5]
  - @koishi-ce/loader@1.0.1
