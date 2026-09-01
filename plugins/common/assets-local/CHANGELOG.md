# @koishi-ce/plugin-assets-local

## 1.0.1

### Patch Changes

- d1329eb: feat(eco): 再分发五个上游官方插件，补齐官方实例默认插件版图
  
  - **@koishi-ce/plugin-theme-vanilla**（上游 koishijs/theme-vanilla，AGPL）：八套控制台主题（coffee / ocean / pale-night / solarized / winter 各系）
  - **@koishi-ce/plugin-server-temp**（上游 cordiverse/server @cordisjs/plugin-server-temp，MIT，src 化移植）：`server.temp` 服务——临时文件落盘、`/temp/:name` 路由与到期清理
  - **@koishi-ce/assets**（上游 @koishijs/assets 基类包，MIT）+ **@koishi-ce/plugin-assets-local**（上游 koishi-plugin-assets-local，MIT）：assets 资源服务抽象与本地目录实现（魔数判型、HMAC 上传校验、旧 public/ 目录迁移）；文件类型探测改用 file-type@22 的 fileTypeFromBuffer（与 explorer 同线，不引入 16.x 双版本），GET 路由以头部字节判定 MIME
  - **@koishi-ce/plugin-rate-limit**（上游 koishijs/common packages/rate-limit，MIT）：指令调用次数 / 频率限制，usage / timer 管理命令，上游测试全量移植为 bun:test
  - **@koishi-ce/plugin-dataview**（上游 koishijs/koishi-plugin-dataview，AGPL）：控制台数据库查看与管理（minato 深层 API、client 类型镜像走 market 范式）
  - analytics 的未使用依赖 `@koishijs/assets` 换为 `@koishi-ce/assets`
  - 上游 telemetry 评估后放弃移植：未发布半成品、无 LICENSE 正文、硬编码第三方遥测后端且采集机器指纹
- Updated dependencies [d1329eb]
  - @koishi-ce/assets@1.0.1
