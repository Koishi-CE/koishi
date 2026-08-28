# koishi-plugin-marketn-refactored

下一代 Koishi 插件市场与依赖管理中心——对 [koishi-plugin-market-next](https://github.com/qinfeng365/koishi-plugin-market-next) 的大爆炸重构。在 Koishi 控制台里浏览、搜索、安装、升级与卸载插件，管理依赖与本地插件，并提供镜像 failover、市场索引版本共识、环境快照等能力。

## 功能特性

- **插件市场**：多镜像源竞速加载（10 个社区镜像、版本见证共识、磁盘缓存复用）；token 化搜索（`is:` / `not:` / `impl:` / `locale:` / `category:` / 日期比较）、徽章与分类过滤、多维度排序（推荐评分 / 下载量 / 创建 / 更新时间）；作者头像（gravatar / cravatar / npm-avatar 候选链 + 失败缓存）；索引 debug 信息卡（解码大小 / 压缩比 / 候选端点 / 路由评分）。
- **依赖管理**：`/dependencies` 页面分组展示（可折叠持久化）、grid / list 双布局、依赖卡片 11 种状态（pending / local / invalid / bundle / updatable…）、版本选择与覆盖、忽略更新（永久 / 限时策略）。
- **安装域**：单包安装面板（peer 依赖分析与版本选择）、安装进度伪终端（实时 stdout / stderr）、安装历史与日志详情、bulkMode 批量变更确认。
- **Bundle**：`koishi-plugin-pa-*` 插件包一键安装（成员选择 / 冲突告警 / 敏感字段编辑 / 安装 diff 预览）与三选一卸载（清组配置 / 删依赖 / 保留）。
- **环境快照**：依赖环境自动留档（上限 60 份）、diff 预览、一键恢复（含本插件自身更新时提示）。
- **本地插件**：`.tgz` 拖拽分片上传（SHA-256 校验 / 脚本警告 / commit 幂等）与 `npm pack` 本地绑定（`file:.yarn/local/...` 请求串）。
- **健壮性**：npm registry 五镜像 failover + 按延迟 / 成功率的健康评分自动路由；安装前本地插件保护（避免包管理器误下载本地依赖）；空闲探测自动刷新元数据。
- **i18n**：中英双语全量文案，market 模块另有 7 语言（zh-CN / en-US / zh-TW / ja / de / fr / ru）。

## 安装

在 Koishi 控制台的插件市场搜索 `marketn-refactored` 安装，或：

```bash
npm install koishi-plugin-marketn-refactored
```

要求 Node ≥ 20.19，宿主使用 json / yaml 配置文件（插件需要写回 package.json 与 Koishi 配置）。

## 配置摘要

| 配置项 | 默认 | 说明 |
|---|---|---|
| `idleProbe` | `true` | 空闲时后台探测刷新依赖与市场元数据 |
| `idleProbeDelay` / `idleProbeBootDelay` / `idleProbeInterval` | 5min / 1min / 6h | 空闲探测延迟 / 启动延迟 / 间隔 |
| `registry.endpoint` | （自动） | npm registry 地址，留空自动按 .npmrc 与镜像路由 |
| `registry.timeout` / `retry` / `concurrency` | 5s / 1 / 4 | registry 请求超时 / 重试 / 并发 |
| `registry.installLogRetentionHours` | 72 | 安装日志保留时长（小时） |
| `search.endpoint` | t4wefan 镜像 | 市场索引地址 |
| `search.timeout` / `autoRoute` / `logLevel` | 30s / true / warn | 索引请求超时 / 自动路由 / 日志级别 |

另有隐藏配置：`bulkMode`、`removeConfig`、`updateIgnoredPackages`、`updateIgnoreDuration`、`updateIgnoreVersions`、`updateIgnorePrerelease`、`collapsedGroups`、`marketSilentRules`（市场静默规则表）等，均由前端页面自动写入。

## 社区镜像列表

如果插件市场页面提示「无法连接到插件市场」，可以选择一个 Koishi 社区提供的镜像地址，填入 `search.endpoint`：

- Koishi（全球）：`https://registry.koishi.chat/index.json`
- [Gitee 聚合](https://k.ilharp.cc/4000)（大陆）：`https://gitee.com/shangxueink/koishi-registry-aggregator/raw/gh-pages/market.json`
- [t4wefan](https://k.ilharp.cc/2611)（大陆）：`https://registry.koishi.t4wefan.pub/index.json`
- [Lipraty](https://k.ilharp.cc/3530)（大陆）：`https://koi.nyan.zone/registry/index.json`
- [itzdrli](https://k.ilharp.cc/9975)（全球）：`https://kp.itzdrli.cc`
- itzdrli 备用：`https://koishi.itzdrli.cc`
- Koishi Registry GitHub Pages：`https://koishijs.github.io/registry/index.json`
- Koishi Registry GitHub Raw：`https://raw.githubusercontent.com/koishijs/registry/release/index.json`
- Koishi Registry jsDelivr：`https://cdn.jsdelivr.net/gh/koishijs/registry@release/index.json`
- Koishi Registry GitHub 代理：`https://ghproxy.net/https://raw.githubusercontent.com/koishijs/registry/release/index.json`
- Koishi Registry GitHub 代理 2：`https://ghfast.top/https://raw.githubusercontent.com/koishijs/registry/release/index.json`

要浏览更多社区镜像，请访问 [Koishi 论坛上的镜像一览](https://k.ilharp.cc/4000)。

## 命令（均需 authority 4）

| 命令 | 别名 | 说明 |
|---|---|---|
| `plugin.install <name>` | `.i` | 安装插件并自动创建插件配置 |
| `plugin.uninstall <name>` | `.r` | 卸载插件 |
| `plugin.upgrade [name...]` | `.update` / `.up` | 升级插件（`-s, --koishi` 升级 Koishi 本体，`-f, --force` 忽略更新忽略策略） |
| `plugin.clear-avatar-cache` | — | 清空头像内存 + 磁盘缓存并返回统计 |

## 许可证

[AGPL-3.0](LICENSE) 开源。感谢原作者 *qinfeng365* 提供的初始想法与代码基础（[koishi-plugin-market-next](https://github.com/qinfeng365/koishi-plugin-market-next)）。
