# @koishi-ce/plugin-hmr

## 1.0.4

### Patch Changes

- 4298163: 修复 1.0.5 / 1.0.6 / 1.0.3 发布产物的 dependencies 残留 `workspace:*` 协议问题（2026-08-31 事故：该波发布绕过了发布链的 workspace 协议改写环，三个版本原样带上 npm，下游 `bun install` 直接报 "Workspace dependency not found"）。本版本经发布链正确改写后重新发布以覆盖 latest；发布链已加终局断言（改写后依赖字段不得残留 workspace:/file:/link:）与 `--only` 精确重发能力，杜绝再犯。

## 1.0.3

### Patch Changes

- Updated dependencies [6f77b35]
  - @koishi-ce/loader@1.0.3
  - @koishijs/loader@4.6.11
  - koishi@4.18.11

## 1.0.2

### Patch Changes

- Updated dependencies [bcfbe4e]
  - @koishi-ce/loader@1.0.2
  - koishi@4.18.11

## 1.0.1

### Patch Changes

- a772c44: 修复 Bun 运行时下 webui 长时间转圈无法加载的问题：hmr 的 chokidar 在 win32 上以反斜杠原生路径调用匹配器，glob 形式的 ignored 完全失效，导致巨型 node_modules 被完整遍历（每秒数万条目、持续数分钟），事件循环被 IO 回调风暴挤压，server 的 HTTP 请求 72 秒以上无响应——现将「双星通配包裹目录名」的忽略规则编译为目录段剪枝函数，目录命中即整树剪枝（实测初始扫描从 99 秒未就绪降到 267ms）。另修复 market 两处启动报错：Scanner 构造裸取 registry.get 丢失 this 抛 TypeError（包一层箭头函数保持绑定）；本机 npmrc 无 registry 配置时 endpoint 无默认回落，相对 URL 在 resolveURL 抛 Invalid URL（回落 npm 官方源，对齐被移除的 get-registry 默认值）。
- Updated dependencies [c9f7ef5]
  - @koishi-ce/loader@1.0.1
