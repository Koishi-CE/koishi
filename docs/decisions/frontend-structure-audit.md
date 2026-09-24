# 前端组织规范性审查（FRONTEND STRUCTURE AUDIT）

> 对 `packages/web/*` 与 `plugins/webui/*` 前端代码组织的一次**现势审查快照**：完整文件树、实然职责说明、约定锚点、问题清单与整改建议。本文只做盘点与论证，不含代码改动。
> **本版为重拍**（2026-09-24 实测，全部数字为该日在本仓实跑统计）。上一版（2026-09-22）的主结论「`packages/web/client` 一个包承担四种职责」已随两步拆包（`@koishi-ce/console-builder` → `@koishi-ce/console-app`）失效；本版按拆分**后**的结构重写全篇，并在 §6.1 逐条核销旧版问题。§6 的整改建议为讨论稿，落地前需维护者确认。
> 相关：[../reference/architecture.md](../reference/architecture.md) §2 包清单 / §4 构建体系 · [../process/upstream.md](../process/upstream.md) Restructure map · [../guides/development.md](../guides/development.md) §3 门禁。
> **本文结构**：1 前端文件树（完整）· 2 范围、方法与基线 · 3 职责说明 · 4 约定锚点 · 5 问题清单 · 6 整改建议 · 7 附录：职责速查表。

## 1. 前端文件树（完整）

**口径**（完整定义见 §2.1）：只列浏览器侧代码与其他前端接线文件；排除 `node_modules/`、`lib/`、`dist/`（后两者为构建产物，由 `.gitignore` 覆盖）；排除 `plugins/webui/*/src/`（node 侧）与包根元数据（`package.json` / `tsconfig.json` / `README.md` / `CHANGELOG.md`）。

- `packages/web/` 4 个包**全量**列出（154 文件）。其中 `builder/` 是 node 侧构建器、不属浏览器侧，这里附列以便读者一次看清前端工具链的位置。
- `plugins/webui/` 只列 `*/client/`（326 文件）与 `*/build/`（1 文件）。`actions` / `console` / `oobe` 三个包没有 `client/`，故整包不出现在树中（原因见 §3.6）。
- 与上游的目录改名：本仓 `packages/web/{app,client,components}` 的源码目录一律为 `src/`（对应上游 `packages/client/{app,client}` 与 `packages/components/client`）；`plugins/webui/*/client/` 刻意不改名。映射见 [../process/upstream.md](../process/upstream.md) Restructure map。

```text
packages/web/
├── app/
│   ├── package.json
│   ├── README.md
│   ├── src/
│   │   ├── assets/
│   │   │   └── logo.png
│   │   ├── home/
│   │   │   ├── home.vue
│   │   │   └── index.ts
│   │   ├── index.html
│   │   ├── index.scss
│   │   ├── index.ts
│   │   ├── layout/
│   │   │   ├── header.vue
│   │   │   ├── index.ts
│   │   │   ├── layout.vue
│   │   │   └── menu-item.vue
│   │   ├── settings/
│   │   │   ├── index.ts
│   │   │   ├── settings.vue
│   │   │   └── theme.vue
│   │   ├── shims.d.ts
│   │   ├── status/
│   │   │   ├── index.ts
│   │   │   ├── loading.vue
│   │   │   └── status.vue
│   │   ├── styles/
│   │   │   ├── element.scss
│   │   │   ├── hc.scss
│   │   │   ├── index.scss
│   │   │   ├── index.ts
│   │   │   └── layout.scss
│   │   └── theme/
│   │       ├── activity/
│   │       │   ├── button.vue
│   │       │   ├── index.vue
│   │       │   ├── item.vue
│   │       │   ├── separator.vue
│   │       │   └── utils.ts
│   │       ├── blank.vue
│   │       ├── index.ts
│   │       ├── index.vue
│   │       ├── menu/
│   │       │   ├── index.vue
│   │       │   ├── menu-item.vue
│   │       │   └── menu.vue
│   │       └── status.vue
│   └── tsconfig.json
├── builder/
│   ├── package.json
│   ├── README.md
│   ├── src/
│   │   ├── app.ts
│   │   ├── assemble.ts
│   │   ├── bin.ts
│   │   ├── index.ts
│   │   └── yaml.ts
│   ├── tsconfig.json
│   └── tsdown.config.ts
├── client/
│   ├── CHANGELOG.md
│   ├── global.d.ts
│   ├── package.json
│   ├── README.md
│   └── src/
│       ├── components/
│       │   ├── chat/
│       │   │   ├── image.vue
│       │   │   ├── overlay.vue
│       │   │   └── utils.ts
│       │   ├── common/
│       │   │   ├── index.ts
│       │   │   ├── k-button.vue
│       │   │   ├── k-hint.vue
│       │   │   └── k-tab.vue
│       │   ├── dynamic.vue
│       │   ├── icons/
│       │   │   ├── activity/
│       │   │   │   ├── default.vue
│       │   │   │   ├── ellipsis.vue
│       │   │   │   ├── home.vue
│       │   │   │   ├── moon.vue
│       │   │   │   ├── settings.vue
│       │   │   │   └── sun.vue
│       │   │   ├── index.ts
│       │   │   ├── style.scss
│       │   │   └── svg/
│       │   │       ├── arrow-left.vue
│       │   │       ├── arrow-right.vue
│       │   │       ├── box-open.vue
│       │   │       ├── check-full.vue
│       │   │       ├── chevron-down.vue
│       │   │       ├── chevron-left.vue
│       │   │       ├── chevron-right.vue
│       │   │       ├── chevron-up.vue
│       │   │       ├── clipboard-list.vue
│       │   │       ├── edit.vue
│       │   │       ├── exclamation-full.vue
│       │   │       ├── expand.vue
│       │   │       ├── file-archive.vue
│       │   │       ├── filter.vue
│       │   │       ├── github.vue
│       │   │       ├── gitlab.vue
│       │   │       ├── info-full.vue
│       │   │       ├── koishi.vue
│       │   │       ├── link.vue
│       │   │       ├── paper-plane.vue
│       │   │       ├── question-empty.vue
│       │   │       ├── redo.vue
│       │   │       ├── search-minus.vue
│       │   │       ├── search-plus.vue
│       │   │       ├── search.vue
│       │   │       ├── star-empty.vue
│       │   │       ├── star-full.vue
│       │   │       ├── start.vue
│       │   │       ├── tag.vue
│       │   │       ├── times-full.vue
│       │   │       ├── tools.vue
│       │   │       ├── undo.vue
│       │   │       └── user.vue
│       │   ├── index.ts
│       │   ├── layout/
│       │   │   ├── card.vue
│       │   │   ├── content.vue
│       │   │   ├── empty.vue
│       │   │   ├── index.ts
│       │   │   ├── tab-group.vue
│       │   │   └── tab-item.vue
│       │   ├── link.ts
│       │   ├── markdown.test.ts
│       │   ├── markdown.ts
│       │   ├── perms.vue
│       │   └── slot.ts
│       ├── context.ts
│       ├── data.ts
│       ├── index.ts
│       ├── locales/
│       │   ├── de-DE.yml
│       │   ├── en-US.yml
│       │   ├── fr-FR.yml
│       │   ├── ja-JP.yml
│       │   ├── ru-RU.yml
│       │   ├── zh-CN.yml
│       │   └── zh-TW.yml
│       ├── plugins/
│       │   ├── action.ts
│       │   ├── i18n.ts
│       │   ├── loader.ts
│       │   ├── messages.ts
│       │   ├── router.ts
│       │   ├── setting.ts
│       │   └── theme.ts
│       ├── shims.d.ts
│       ├── tsconfig.json
│       └── utils.ts
└── components/
    ├── CHANGELOG.md
    ├── package.json
    ├── README.md
    └── src/
        ├── form/
        │   ├── computed.vue
        │   ├── index.ts
        │   ├── k-filter-button.vue
        │   ├── k-filter-expr.vue
        │   ├── k-filter-types.ts
        │   └── k-filter.vue
        ├── image-viewer.vue
        ├── index.scss
        ├── index.ts
        ├── k-comment.vue
        ├── schemastery-vue-client.ts
        ├── schemastery-vue-runtime.ts
        ├── shims.d.ts
        ├── tsconfig.json
        ├── viewer-toolbar.scss
        └── virtual/
            ├── index.ts
            ├── item.ts
            ├── list.vue
            ├── virtual.test.ts
            └── virtual.ts
plugins/webui/
├── admin/
│   └── client/
│       ├── group.vue
│       ├── icons/
│       │   ├── activity.vue
│       │   └── trash-can.vue
│       ├── index.ts
│       ├── name.vue
│       ├── shims.d.ts
│       └── tsconfig.json
├── analytics/
│   ├── build/
│   │   └── client.ts
│   └── client/
│       ├── charts/
│       │   ├── bot.ts
│       │   ├── command.ts
│       │   ├── echarts.ts
│       │   ├── history.ts
│       │   ├── hour.ts
│       │   ├── index.scss
│       │   ├── index.ts
│       │   └── utils.ts
│       ├── home.vue
│       ├── icons/
│       │   ├── guild.vue
│       │   ├── heart.vue
│       │   ├── history.vue
│       │   ├── index.ts
│       │   └── user.vue
│       ├── index.ts
│       ├── locales/
│       │   ├── de-DE.yml
│       │   ├── en-US.yml
│       │   ├── fr-FR.yml
│       │   ├── ja-JP.yml
│       │   ├── ru-RU.yml
│       │   ├── zh-CN.yml
│       │   └── zh-TW.yml
│       ├── numbers/
│       │   ├── index.vue
│       │   └── numeric.vue
│       └── tsconfig.json
├── auth/
│   └── client/
│       ├── bind-dialog.vue
│       ├── icons/
│       │   ├── at.vue
│       │   ├── check.vue
│       │   ├── lock.vue
│       │   ├── sign-in.vue
│       │   ├── sign-out.vue
│       │   └── user-full.vue
│       ├── index.ts
│       ├── login-form.vue
│       ├── login.vue
│       ├── profile.vue
│       ├── sync-dialog.vue
│       ├── tsconfig.json
│       └── utils.ts
├── commands/
│   └── client/
│       ├── command.vue
│       ├── commands.vue
│       ├── icons/
│       │   ├── activity.vue
│       │   ├── check.vue
│       │   └── trash-can.vue
│       ├── index.ts
│       ├── locales.vue
│       ├── settings.vue
│       ├── tsconfig.json
│       └── utils.ts
├── config/
│   └── client/
│       ├── components/
│       │   ├── env-info.ts
│       │   ├── forks.vue
│       │   ├── global.vue
│       │   ├── group.vue
│       │   ├── index.vue
│       │   ├── modifier.vue
│       │   ├── plugin.vue
│       │   ├── select.vue
│       │   ├── tree.ts
│       │   ├── tree.vue
│       │   └── utils.ts
│       ├── icons/
│       │   ├── add-group.vue
│       │   ├── add-plugin.vue
│       │   ├── check.vue
│       │   ├── clone.vue
│       │   ├── index.ts
│       │   ├── manage.vue
│       │   ├── play.vue
│       │   ├── plugin.vue
│       │   ├── save.vue
│       │   ├── stop.vue
│       │   └── trash-can.vue
│       ├── index.scss
│       ├── index.ts
│       ├── locales/
│       │   ├── de-DE.yml
│       │   ├── en-US.yml
│       │   ├── fr-FR.yml
│       │   ├── ja-JP.yml
│       │   ├── ru-RU.yml
│       │   ├── zh-CN.yml
│       │   └── zh-TW.yml
│       └── tsconfig.json
├── dataview/
│   └── client/
│       ├── components/
│       │   ├── cell.ts
│       │   ├── column-inputs.ts
│       │   └── data-table.vue
│       ├── config.ts
│       ├── console-services.ts
│       ├── icons/
│       │   ├── database.vue
│       │   ├── filter-off.vue
│       │   ├── filter-on.vue
│       │   ├── index.ts
│       │   ├── refresh.vue
│       │   ├── rgb-off.vue
│       │   └── rgb-on.vue
│       ├── index.ts
│       ├── index.vue
│       ├── locales/
│       │   ├── de-DE.yml
│       │   ├── en-US.yml
│       │   ├── fr-FR.yml
│       │   ├── ja-JP.yml
│       │   ├── ru-RU.yml
│       │   ├── zh-CN.yml
│       │   └── zh-TW.yml
│       ├── tsconfig.json
│       └── utils.ts
├── explorer/
│   └── client/
│       ├── editor.scss
│       ├── editor.ts
│       ├── file-picker.vue
│       ├── icons/
│       │   ├── activity.vue
│       │   ├── directory-create.vue
│       │   ├── directory.vue
│       │   ├── download.vue
│       │   ├── file-create.vue
│       │   ├── file.vue
│       │   ├── index.ts
│       │   ├── refresh.vue
│       │   ├── save.vue
│       │   ├── symlink.vue
│       │   └── upload.vue
│       ├── index.ts
│       ├── index.vue
│       ├── languages.test.ts
│       ├── languages.ts
│       ├── locales/
│       │   ├── de-DE.yml
│       │   ├── en-US.yml
│       │   ├── fr-FR.yml
│       │   ├── ja-JP.yml
│       │   ├── ru-RU.yml
│       │   ├── zh-CN.yml
│       │   └── zh-TW.yml
│       ├── rename.ts
│       ├── status.vue
│       ├── store.ts
│       ├── tsconfig.json
│       └── upload.vue
├── insight/
│   └── client/
│       ├── icons/
│       │   ├── index.ts
│       │   └── network.vue
│       ├── index.ts
│       ├── index.vue
│       ├── link.vue
│       ├── locales/
│       │   ├── de-DE.yml
│       │   ├── en-US.yml
│       │   ├── fr-FR.yml
│       │   ├── ja-JP.yml
│       │   ├── ru-RU.yml
│       │   ├── zh-CN.yml
│       │   └── zh-TW.yml
│       ├── node.vue
│       ├── tooltip.ts
│       ├── tsconfig.json
│       └── utils.ts
├── locales/
│   └── client/
│       ├── icons/
│       │   ├── activity.vue
│       │   └── globe.vue
│       ├── index.ts
│       ├── locales.vue
│       └── tsconfig.json
├── logger/
│   └── client/
│       ├── icons/
│       │   ├── index.ts
│       │   └── logs.vue
│       ├── index.scss
│       ├── index.ts
│       ├── index.vue
│       ├── logs.vue
│       ├── settings.vue
│       └── tsconfig.json
├── market/
│   └── client/
│       ├── components/
│       │   ├── confirm.vue
│       │   ├── install.vue
│       │   ├── manual.vue
│       │   ├── market.vue
│       │   ├── progress.vue
│       │   ├── remove-config-dialog.vue
│       │   └── utils.ts
│       ├── console-services.ts
│       ├── dependencies/
│       │   ├── dependencies.scss
│       │   ├── dependencies.vue
│       │   ├── dependency-groups.test.ts
│       │   ├── dependency-groups.ts
│       │   ├── dependency-helpers.test.ts
│       │   ├── dependency-helpers.ts
│       │   ├── ignore-dialog.vue
│       │   ├── ignore-policy.test.ts
│       │   ├── ignore-policy.ts
│       │   └── package.vue
│       ├── extensions/
│       │   ├── dep-link.vue
│       │   ├── dependency.vue
│       │   ├── index.ts
│       │   ├── missing.vue
│       │   ├── select.vue
│       │   ├── uninstall.test.ts
│       │   ├── uninstall.ts
│       │   └── version.vue
│       ├── icons/
│       │   ├── activity/
│       │   │   ├── deps.vue
│       │   │   └── market.vue
│       │   ├── index.ts
│       │   └── market/
│       │       ├── refresh.vue
│       │       └── rocket.vue
│       ├── index.ts
│       ├── locales/
│       │   ├── en-US.yml
│       │   └── zh-CN.yml
│       ├── market/
│       │   ├── filter.vue
│       │   ├── list.vue
│       │   ├── package.vue
│       │   └── search.vue
│       ├── tsconfig.json
│       ├── utils.ts
│       └── vendor/
│           └── market/
│               ├── icons/
│               │   ├── index.ts
│               │   ├── misc/
│               │   │   ├── asc.vue
│               │   │   ├── award.vue
│               │   │   ├── balance.vue
│               │   │   ├── close.vue
│               │   │   ├── desc.vue
│               │   │   ├── download.vue
│               │   │   ├── file-archive.vue
│               │   │   ├── heart-pulse.vue
│               │   │   ├── index.ts
│               │   │   ├── insecure.vue
│               │   │   ├── installed.vue
│               │   │   ├── newborn.vue
│               │   │   ├── portable.vue
│               │   │   ├── preview.vue
│               │   │   ├── search.vue
│               │   │   ├── star-empty.vue
│               │   │   ├── star-full.vue
│               │   │   ├── star-half.vue
│               │   │   ├── tag.vue
│               │   │   └── verified.vue
│               │   ├── outline/
│               │   │   ├── adapter.vue
│               │   │   ├── ai.vue
│               │   │   ├── core.vue
│               │   │   ├── extension.vue
│               │   │   ├── game.vue
│               │   │   ├── gametool.vue
│               │   │   ├── general.vue
│               │   │   ├── image.vue
│               │   │   ├── index.ts
│               │   │   ├── life.vue
│               │   │   ├── manage.vue
│               │   │   ├── media.vue
│               │   │   ├── meme.vue
│               │   │   ├── other.vue
│               │   │   ├── preset.vue
│               │   │   ├── tool.vue
│               │   │   └── webui.vue
│               │   └── solid/
│               │       ├── adapter.vue
│               │       ├── ai.vue
│               │       ├── all.vue
│               │       ├── core.vue
│               │       ├── extension.vue
│               │       ├── game.vue
│               │       ├── gametool.vue
│               │       ├── general.vue
│               │       ├── image.vue
│               │       ├── index.ts
│               │       ├── life.vue
│               │       ├── manage.vue
│               │       ├── media.vue
│               │       ├── meme.vue
│               │       ├── other.vue
│               │       ├── preset.vue
│               │       ├── tool.vue
│               │       └── webui.vue
│               ├── index.ts
│               ├── locales/
│               │   └── zh-CN.yml
│               ├── utils.test.ts
│               └── utils.ts
├── notifier/
│   └── client/
│       ├── config.vue
│       ├── index.ts
│       └── tsconfig.json
├── sandbox/
│   └── client/
│       ├── icons/
│       │   ├── flask.vue
│       │   └── index.ts
│       ├── index.ts
│       ├── layout.vue
│       ├── message.vue
│       ├── tsconfig.json
│       └── utils.ts
├── status/
│   └── client/
│       ├── analytics.vue
│       ├── bots/
│       │   ├── index.ts
│       │   ├── index.vue
│       │   ├── light.vue
│       │   ├── preview.vue
│       │   └── utils.ts
│       ├── config.vue
│       ├── envinfo.vue
│       ├── icons/
│       │   ├── arrow-down.vue
│       │   ├── arrow-up.vue
│       │   ├── index.ts
│       │   ├── platform.vue
│       │   ├── pulse.vue
│       │   └── robot.vue
│       ├── index.ts
│       ├── load/
│       │   ├── index.ts
│       │   ├── index.vue
│       │   ├── load-bar.vue
│       │   └── utils.ts
│       ├── tsconfig.json
│       └── utils.ts
├── theme-vanilla/
│   └── client/
│       ├── index.scss
│       ├── index.ts
│       ├── themes/
│       │   ├── _mixins.scss
│       │   ├── coffee-dark.scss
│       │   ├── coffee-light.scss
│       │   ├── ocean-dark.scss
│       │   ├── ocean-light.scss
│       │   ├── pale-night.scss
│       │   ├── solarized-dark.scss
│       │   ├── solarized-light.scss
│       │   └── winter-dark.scss
│       └── tsconfig.json
└── welcome/
    └── client/
        ├── index.ts
        ├── locales/
        │   ├── de-DE.yml
        │   ├── en-US.yml
        │   ├── fr-FR.yml
        │   ├── ja-JP.yml
        │   ├── ru-RU.yml
        │   ├── zh-CN.yml
        │   └── zh-TW.yml
        ├── lottie-light.d.ts
        ├── splash.json
        ├── splash.vue
        ├── tsconfig.json
        └── welcome.vue
```

---

## 2. 范围、方法与基线

### 2.1 范围

审查对象为仓库内全部浏览器侧代码与承载它们的包结构：

| 纳入 | 说明 |
|---|---|
| `packages/web/app` | 宿主 SPA 源码（`@koishi-ce/console-app`） |
| `packages/web/client` | 浏览器运行时库（`@koishi-ce/client`） |
| `packages/web/components` | 共享组件库（`@koishi-ce/components`） |
| `packages/web/builder` | node 侧构建器 / 开发服务器 / CLI / 宿主总装（`@koishi-ce/console-builder`）——不属浏览器侧，但前端构建的全部接线在此，纳入范围 |
| `plugins/webui/*/client`（16 个） | 各控制台插件的前端实现 |
| `plugins/webui/*/build`（1 个） | 插件自带 vite 配置覆盖 |
| `plugins/webui/*/locales`、`client/locales` | 词典（分别供 node 侧 / 浏览器侧消费） |

**不在范围**：`packages/node/*`、`plugins/{common,infra}/*`、`apps/*`、`tooling/*`；`plugins/webui/*/src/`（node 侧）只在需要说明与 `client/` 的关系时提及。

### 2.2 方法

- 全量文件树扫描，排除 `node_modules/` / `lib/` / `dist/` 三类产物与依赖噪声（§1 的树由脚本生成，非手抄）。
- 对构建接线、类型接线、包元数据做源码级核对（不使用推测）；与上游的差异用 GitHub 原始文件对账（本版据此把旧版的「待确认项」定性为确定缺口，见 §5.1 A3）。
- 结论口径：**实测到的差异才记为问题**；每条问题附证据路径。

### 2.3 基线数据（2026-09-24 实测）

| 指标 | 数值 |
|---|---|
| 前端范围源文件总数（不含 node_modules / lib / dist） | 481 |
| `packages/web/` · `plugins/webui/*/client/` · `plugins/webui/*/build/` | 154 · 326 · 1 |
| 前端口径 `.vue` / `.ts`（含 `.d.ts`、`*.test.ts`）/ `.yml` / `.json` / `.scss` / `.md` / 其他 | 249 / 124 / 52 / 25 / 23 / 6 / 2 |
| `packages/web` 包数 | 4（app · client · components · builder） |
| `plugins/webui` 包数 / 其中有 `client/` 的 | 19 / 16 |
| `icons/` 目录数 / 其中的 `.vue` 图标文件 | 15 / 146 |
| `.vue` 图标同名组数（跨目录）/ 其中跨「主图标库 ↔ market vendor 树」 | 28 / 5 |
| `locales/` 目录数（含 `.yml` 的；前端侧 9 个全部形如 `client/locales/`） | 19 |
| 前端侧测试文件（`client/` 或 `packages/web` 下 `*.test.ts`） | 8（market 5 · explorer 1 · client 1 · components 1） |
| 全仓引用的外部上游包（前端侧） | 仅 `@koishijs/plugin-server-proxy`（console 的类型引用） |

### 2.4 结论摘要

**架构方向没有问题**：`插件 client/ 源码 + 插件 dist/ 产物 + console 宿主统一总装 + 运行时共享块（vue / vue-router / vueuse / @koishi-ce/client 各一份）` 仍是本仓库前端的基本盘，它让每个控制台插件可独立发布、可独立构建，同时避免运行时出现多份 Vue 实例。这套约定源自上游 webui，有明确的工程理由，**不应推翻**。

**上一版指出的最大结构问题已解决**：`packages/web/client` 已按运行时切成四个包（`app` 宿主 SPA · `client` 浏览器库 · `components` 共享组件库 · `builder` node 侧构建器），三个浏览器侧包源码目录统一为 `src/`，`files` 死项与空壳 `build/` 目录一并清理（核销明细见 §6.1）。**本版由此不再有 A 级「包结构」问题**，剩余问题集中在资产、词典与命名一致性：

1. **图标资产没有单一来源**（A1）：15 个 `icons/` 目录、28 组同名图标；其中 5 组是「主图标库 ↔ market vendor 树」的**本仓可控重复**，其余属上游「插件前端自洽」约定的有意重复。
2. **词典双份同构**（A2）：19 个 `locales/` 目录里，`explorer` / `analytics` 同时存在 `locales/`（node 侧）与 `client/locales/`（浏览器侧）且键集同构，改一侧易漏另一侧。
3. **一个已定性的移植缺口**（A3）：`config` / `market` 的 `src/browser/` 在上游 `exports` 中有 `browser` 条件，本仓移植时丢失；`console` 保留了。当前无仓内消费者，属**潜在**故障面而非活跃故障。
4. **跨包源码引用两种写法并存**（A4）：4 个 `.ts` 用相对路径穿越包边界引用 `@koishi-ce/components`，2 个 `.vue` 用包名，且相对路径处的注释理由已过时。

其余为一致性与命名层面的欠账（§5.2、§5.3），不影响功能，但持续产生认知成本与漏改风险。

---

## 3. 职责说明（实然结构）

本节回答「每个目录到底是干什么的」——这是后续一切规范讨论的基础。以下职责均以源码与包元数据为准。

### 3.1 分区总览

| 位置 | 运行位置 | 独立产物 | 职责 |
|---|---|---|---|
| `packages/web/app` | 构建期（vite 现场编译） | 无 | 宿主控制台 SPA 源码，`src/` 即 vite root |
| `packages/web/client` | 浏览器 | 无（并成宿主 `client.js`） | 浏览器运行时库：根 Context、核心服务、内置组件、工具 |
| `packages/web/components` | 浏览器 | 无（并进宿主 `client.js`） | 共享组件库（表单 / 虚拟列表 / 展示件） |
| `packages/web/builder` | Node（构建期） | `lib/`（走根 tsdown） | 编程式构建器、开发服务器、`koishi-console` CLI、宿主总装 |
| `plugins/webui/*/client` | 浏览器 | 同包 `dist/` | 插件前端（Vue 组件 + 控制台注册） |
| `plugins/webui/*/build` | 构建期 | —— | 可选的 vite 配置覆盖入口 |

### 3.2 `packages/web/app`（`@koishi-ce/console-app`）

宿主 SPA 源码，**只发布源码**（`files: ["src"]`），由宿主总装（构建期）与 `devMode`（运行期）以它为 vite root 消费。`exports` **刻意只暴露 `./package.json`**——该包的对外契约就是「一个可被按包名解析到的目录」，定位逻辑见 §4.1。

| 路径 | 职责 |
|---|---|
| `src/index.html` | 宿主 HTML 模板（vite 入口） |
| `src/index.ts` | 应用入口：按序 `root.plugin(...)` 注册六个内置插件（home / layout / settings / status / styles / theme），非静态模式下连 WebSocket |
| `src/home/` | 首页（welcome 插件的宿主侧插槽落点） |
| `src/layout/` | 布局：`layout.vue` + `header.vue` + `menu-item.vue` |
| `src/settings/` | 设置页：`settings.vue` + `theme.vue` |
| `src/status/` | 状态栏：`status.vue` + `loading.vue` |
| `src/theme/` | 主题与外观：`index.vue` 外壳、`menu/`（侧栏）、`activity/`（活动项，含 `button/item/separator/utils`）、`blank.vue`、`status.vue` |
| `src/styles/` | 全局样式：`element.scss`（element-plus 覆盖）、`hc.scss`（高对比度）、`layout.scss`、`index.scss` |
| `src/assets/logo.png` | 宿主 logo |
| `src/shims.d.ts` | 引用 `@koishi-ce/client/global` 的类型垫片 |

### 3.3 `packages/web/client`（`@koishi-ce/client`）

对外发布的**浏览器运行时库**，源码直出（无独立产物），由宿主总装并成 `client.js` 供所有插件 external 共享。

| 路径 | 职责 |
|---|---|
| `src/index.ts` | 库主入口：创建根 Context、安装组件库、`export *` 汇总公共 API、声明可被插件合并增强的 `ActionContext` / `ClientConfig` |
| `src/context.ts` | 根 Context 与 `Internal` 接口 |
| `src/data.ts` | 控制台数据层（与服务端同步的响应式状态） |
| `src/utils.ts` | 工具与 `Service` 基类、`scrollActiveTree` |
| `src/plugins/` | 七个核心服务插件：`action` · `i18n` · `loader` · `messages` · `router` · `setting` · `theme`（`loader` 即动态加载各插件 entry 的服务） |
| `src/components/` | 内置组件与图标（组件与纯逻辑混排，见 §5.2 B3） |
| `src/locales/` | 库自带词典（7 语种） |
| `global.d.ts` | 对外发布的浏览器全局类型垫片（`*.vue` / `*.yml` 模块声明 + 三个 `/// <reference types>`） |

### 3.4 `packages/web/components`（`@koishi-ce/components`）

| 路径 | 职责 |
|---|---|
| `src/index.ts` | 库入口：`export *` 表单与虚拟列表，`export default` 安装函数（注册 `k-comment` / `k-image-viewer`） |
| `src/form/` | 表单：`schemastery-vue` 集成、`k-filter` 条件过滤器族（`computed.vue` / `k-filter.vue` / `k-filter-expr.vue` / `k-filter-button.vue` / `k-filter-types.ts`） |
| `src/virtual/` | 虚拟列表：`list.vue` + `virtual.ts`（范围与占位计算）+ `item.ts`（尺寸测量） |
| `src/image-viewer.vue`、`src/k-comment.vue` | 两个通用展示组件，平铺在 `src/` 根 |
| `src/schemastery-vue-client.ts` / `schemastery-vue-runtime.ts` | 虚拟子路径 `schemastery-vue/client` 的类型载体 / 运行时载体（前者供 tsconfig paths，后者供构建别名） |
| `src/index.scss`、`src/viewer-toolbar.scss` | 组件库样式 |

无独立构建产物：源码直出，由 console 打包器并入宿主 `client.js`。

### 3.5 `packages/web/builder`（`@koishi-ce/console-builder`）

前端构建的**唯一接线点**——本仓库没有 vite 配置文件，一切都在这五文件里。

| 路径 | 职责 |
|---|---|
| `src/index.ts` | 对外的两个编程式 API：`build(root)`（单插件前端 → `<root>/dist`，含 `collectWorkspaceAliases()`）与 `createServer(baseDir)`（devMode 的 middleware 模式 dev server）；同时转出 `locateApp` |
| `src/app.ts` | **宿主 SPA 定位的唯一入口**：按包名解析 `@koishi-ce/console-app/package.json` 再取 `../src`，源码形态（`src/`）与产物形态（`lib/`）下结果一致 |
| `src/assemble.ts` | 宿主前端**总装**（CLI 无参分支背后的实现），产物固定写入 `plugins/webui/console/dist`，源码根按层数上跳定位并在非仓库形态显式报错 |
| `src/bin.ts` | `koishi-console` CLI（`build [root]` + `-h` / `-v`） |
| `src/yaml.ts` | vite 的 yaml/yml 插件（`.yml` 词典导入） |

### 3.6 `plugins/webui/*`：双面包

每个控制台插件是一个双面包，`src/` 与 `client/` 是同一插件的两个运行环境实现：

| 路径 | 运行位置 | 职责 |
|---|---|---|
| `src/` | Node（Koishi 应用内） | 插件主体：注册服务、指令、数据库访问；经 `ctx.console.addEntry()` 声明前端入口 |
| `client/` | 浏览器（控制台内） | 插件前端：Vue 组件 + 页面注册（`ctx.page` / `ctx.slot` / `ctx.menu`）、图标、词典 |
| `dist/` | 浏览器（由宿主下发） | `client/` 的构建产物，固定落在插件目录下（先 `rm` 再重建） |
| `locales/` | Node | 插件主体的词条（被 `src/` 消费） |
| `client/locales/` | 浏览器 | 插件前端的词条 |
| `build/client.ts` | 构建期 | 可选的 vite 配置覆盖入口（`build()` 显式加载，vite 不会自动发现该文件名） |

各插件 `client/` 形态并不统一（这是问题清单的素材，此处只做记录）：

| 形态 | 包 | 数量 |
|---|---|---|
| 有 `client/` 且 `client/index.ts` + `client/tsconfig.json` 齐备 | admin · analytics · auth · commands · config · dataview · explorer · insight · locales · logger · market · notifier · sandbox · status · theme-vanilla · welcome | 16 |
| 其中无 `client/locales/` | admin · commands · locales · logger · market · notifier · sandbox | 7 |
| 其中带 `client/icons/` | admin · analytics · auth · commands · config · dataview · explorer · insight · locales · logger · market · sandbox · status | 13 |
| 其中带 `build/client.ts` | analytics（fuck-echarts 符号遮蔽修补） | 1 |
| 无 `client/`（纯 Node 侧插件） | actions · console · oobe | 3 |
| `src/` 已做 node / browser / shared 三分 | config · console · market | 3 |
| `src/` 为扁平单入口 | 其余 16 个 | 16 |

三个无 `client/` 的插件各有原因，均属合理特例：

- `console`：**宿主**，其 `dist/` 承载全部插件的产物，自身没有需要打包的前端源码（但含 `src/browser/` 浏览器变体，见 §5.1 A3）；
- `actions`：只提供应用级指令与后端 API，无独立页面；
- `oobe`：只提供开箱体验的服务端逻辑。

### 3.7 五个「前端」概念辨析

这是本仓前端**最容易混淆**的地方，必须在文档里钉死：

| 名称 | 含义 | 举例 |
|---|---|---|
| `client/` | 控制台**前端插件**实现（Vue，注册到 UI） | `plugins/webui/logger/client/index.vue` |
| `src/browser/` | Node 侧插件的**浏览器环境变体**（loader 在浏览器里运行时的替代实现），与 UI 无关 | `plugins/webui/config/src/browser/index.ts`、`plugins/webui/market/src/browser/index.ts` |
| `src/`（`packages/web/*`） | 浏览器侧**库/应用源码** | `packages/web/client/src/index.ts` |
| `dist/` | 上述 `client/` 的**构建产物** | `plugins/webui/*/dist/index.js` |
| `app/`（上游旧名） | `packages/web/app` 的前身目录名，本仓已拆为独立包 | 现已不存在 |

`src/browser/` 与 `client/` 同处一包却毫无关系：前者是「插件本体换个运行环境」，后者是「插件的界面」。二者在任何单一目录树里都无法自查，只能靠约定记忆。

---

## 4. 约定锚点

构建与类型系统如何「发现」前端代码——理解这几点，才能判断哪些移动是安全的。

### 4.1 入口发现

| 机制 | 规则 | 判据 |
|---|---|---|
| 插件前端入口 | 固定为 `<插件>/client/index.ts` | `build()` 中 `lib.entry` 硬编码 |
| 无 `client/` 即跳过 | `if (!existsSync(`${root}/client`)) return` | 同一函数首行 |
| 宿主入口（总装） | `locateApp()` + `<app>/index.html` | `assemble.ts` |
| 宿主入口（devMode） | `locateApp()` 同址，`createServer()` 以它为 vite root | `builder/src/index.ts` 与 `plugins/webui/console/src/node/index.ts` 的**两处**等价解析 |
| 构建覆盖 | `<插件>/build/client.ts`，`build()` 显式 `mergeConfig` | vite 不自动发现该文件名 |

> `locateApp()` 与 console 宿主的 devMode 分支是**两份无法合并**的等价实现：builder 顶层 `import * as vite`，而 console 的生产路径不得静态引 builder。改动包名或应用子路径（`src/`）时必须两处同步。

### 4.2 产物落点

| 场景 | 落点 | 是否可配置 |
|---|---|---|
| 单插件前端 | `<插件>/dist/`，先 `rm` 再重建；产物名固定 `index.js` + `style.css`（构建后由 `build()` 手工改名落盘） | 硬编码，不可配 |
| 宿主总装 | `plugins/webui/console/dist`（相对**仓库根**按层数定位，源码形态与产物形态深度一致，非仓库形态显式报错） | 硬编码，不可配 |
| 运行时共享块 | 同上目录的 `vue.js` / `vue-router.js` / `vueuse.js` / `client.js`，各插件以 external 引用 | 固定 |
| 宿主总装其余产物 | 同上目录的 `index.js` / `element.js` / `style.css` / `index.html` / `logo.png` / `rolldown-runtime.js` | 固定 |

### 4.3 别名

- `collectWorkspaceAliases()`：扫描根 `package.json` 的 workspaces glob，为每个有入口的工作区包生成映射——`<name>/src` → 源码目录、`<name>/client` → `client/index.ts`（存在时）、裸名 → `client/index.ts`（存在时）否则 `src/index.ts`。存在理由是**未被任何工作区包依赖的插件不在 `node_modules` 链接里**，bundler 无法按包名解析；**无任何入口的包跳过裸名映射**（避免生成指向不存在路径的假映射）。
- 子路径键必须先插入（别名按插入序取首个命中）。
- 单插件构建另有两条固定别名：`vue-i18n` 与 `@koishi-ce/components` 一律指向 `@koishi-ce/client`（运行时复用宿主的共享块，避免每个插件重复打包）；`@koishijs/components` 指向本仓 components 源码作下游防御。
- `schemastery-vue/client` 别名与 tsconfig paths 成对：运行时载体走构建别名（`locateRuntimeShim()` 探测，失败则省略该键），类型载体走 tsconfig（第三方源码不进类型程序）。
- `devMode` 的 dev server 额外提供向后兼容别名 `../client.js` / `../vue.js` / `../vue-router.js` / `../vueuse.js`，并把 `@koishi-ce/client`、`@koishi-ce/components`、`schemastery-vue(-vue/client)` 从依赖预打包中排除（原因见 `createServer()` 内注释）。
- 下游 npm 安装形态下别名表为空是**正确语义**（读不到仓库根清单即没有源码可映射）。

### 4.4 类型接线

- 检查入口两条：node 侧 `tsconfig.json` + 浏览器侧 `tsconfig.web.json`（paths 为各工程 paths 的合并，exclude 收录各工程 exclude 的并集）。
- 基座 `tsconfig.client.json` 在**仓库根**（`tooling/upstream.md` 记为一个映射项），各 `client/tsconfig.json` 形如 `{"extends": "../../../../tsconfig.client", "include": ["."]}`；`packages/web/{app,client,components}` 则在**包根**放 `tsconfig.json` 并 include `src`。
- **新增 client 工程须同步 `tsconfig.web.json` 的 include**（当前 19 条：3 个 web 包 + 16 个插件）。
- `tsconfig.client.json` 的 `types: []` 保证浏览器纯净，代价是 web 侧 `*.test.ts` 不进类型程序（由 `bun test` 运行时覆盖）；`.vue` 也不进 TS7 程序，由 `tooling/checks/vue-types.ts`（vue-tsc 影子基线）另行把关。
- 实测配对完整：16 个有 `client/` 的包全部带 `client/tsconfig.json`（仅此一项全仓一致）。
- 浏览器端无法引用 node 侧真实插件类型（没有 node_modules 链接、没有 paths），故 console 的类型面靠**手写镜像**——共 16 处（见 §5.2 B5）。

### 4.5 包元数据

| 字段 | 语义 | 消费方 |
|---|---|---|
| `koishi.public` | 声明需要对市场展示的目录 | `@koishi-ce/registry` 的 `Ensure.array(koishi?.public)` |
| `koishi.browser` | 声明插件可在浏览器环境运行 | 插件加载链 |
| `exports` 的 `browser` 条件 | 声明包在浏览器环境的替代入口 | 运行在浏览器里的 loader（§5.1 A3） |
| `files` | npm 打包白名单 | npm / Bun |
| `koishi.description` / `service` | 市场展示与服务依赖声明 | registry / loader |

---

## 5. 问题清单

每条给出：现象 → 证据 → 影响 → 建议。分三级：A 结构性问题、B 一致性问题、C 命名与细节。

### 5.1 A 级：结构性问题

#### A1 图标资产无单一来源，同义图标重复定义

**现象**：15 个 `icons/` 目录、146 个 `.vue` 图标文件；跨目录**同名 28 组**。

**证据（按重复性质分三类）**：

| 类别 | 组数 | 例 | 是否本仓可控 |
|---|---|---|---|
| 主图标库 ↔ market vendor 树 | 5 | `star-empty` · `star-full` · `tag` · `file-archive` · `search`（`packages/web/client/src/components/icons/svg/` ↔ `plugins/webui/market/client/vendor/market/icons/misc/`） | **可控**（vendor 树是同许可本地化的产物） |
| market vendor 树内部 `outline/` ↔ `solid/` | 15 | `adapter` · `ai` · `core` · `extension` · `game` · `gametool` · `general` · `image` · `life` · `media` · `meme` · `other` · `preset` · `tool` · `webui`——同一图标的 outline / solid 两套线型 | 不可控（造型差异是设计意图） |
| 其余（插件本地图标为主） | 8 | `activity`(4 处) · `trash-can`(3) · `check`(3) · `refresh`(3) · `manage`(3) · `save`(2) · `user`(2) · `download`(2)——其中 5 组纯属插件间重复，`user` / `download` / `manage` 三组与主图标库或 vendor 树交叉 | 不可控（上游约定：插件前端自洽，不互相 import） |

**影响**：同一语义的图标在两处实现，视觉与描线细节可能不一致；改一处不会同步另一处。`activity` 四处重复尤其明显（admin / commands / explorer / locales 各画一遍）。

**另注**：主图标库（`@koishi-ce/client` 的 `icons.register`）与 market vendor 树（自带 `name` prop 的独立 registry 组件）是**两套互不相通的注册机制**，这也是重复得以长期存在的原因。

**建议**：见 §6.2 P2——只处理第一类 5 组，不动上游约定的插件自带图标。

#### A2 `locales/` 双份同构，语义靠位置区分

**现象**：19 个 `locales/` 目录，其中两个包同时存在 `locales/`（Node 侧）与 `client/locales/`（浏览器侧），键集同构、语言集相同。

**证据**：

| 包 | `locales/` | `client/locales/` | 差异 |
|---|---|---|---|
| `explorer` | 7 yml | 7 yml | 无（同构） |
| `analytics` | 7 yml | 7 yml | 无（同构） |
| `market` | 14 yml（`message.*` + `schema.*` 双命名） | 2 yml（en-US / zh-CN） | 命名体系不同（已豁免门禁） |
| `welcome` | 无 | 7 yml | 仅前端有词典 |
| `config` / `dataview` / `insight` | 无 | 7 yml | 同上 |
| `admin` / `auth` / `logger` / `status` | 7 yml | 无 | 仅 node 侧有词典 |
| `commands` / `sandbox` | 1 yml（仅 zh-CN） | 无 | 上游即如此（已豁免语种检查） |

**影响**：翻译改动易漏一侧；新人无法从路径判断某词条被 Node 还是浏览器消费；`market` 的双命名与其余包的 `<locale>.yml` 体系并存，同一仓三套词典命名。

**已有防线**：`bun run check:locales`（`tooling/checks/locales.ts`）已覆盖全部 19 个目录的**目录内**键对齐、语种齐全与假翻译检测，但没有**跨目录**（`locales/` ↔ `client/locales/`）的键集一致性校验。

**建议**：见 §6.2 P3——不改路径（会与上游同步冲突），补一条跨目录一致性校验 + 文档钉死语义。

#### A3 `config` / `market` 的 `src/browser/` 缺 `exports.browser` 条件（已定性的移植缺口）

**现象**：三个包都有 `src/browser/index.ts`，但只有 `console` 在 `exports` 里声明了浏览器入口。

**证据（与上游原文对账）**：

| 包 | 上游 `exports["."]` | 本仓 `exports["."]` |
|---|---|---|
| `console` | `node` + `browser` | `node` + `browser` ✅ 保留 |
| `config` | `types` + `node` + **`browser`** | `source` + `types` + `import` + `default` ❌ **丢失** |
| `market` | `types` + `node` + **`browser`** | `source` + `types` + `import` + `default` ❌ **丢失** |

上游 `@koishijs/loader` 的 `exports["."]` 带 `"browser": "./lib/shared.mjs"`，本仓 `@koishi-ce/loader` 同样保留（`packages/node/loader/package.json`），即**浏览器内运行 loader 的协议在本仓仍然存在**；但 `config` / `market` 一旦在浏览器条件解析下被加载，会落到 `lib/index.mjs`（node 入口，带 node 专属导入）而非 `lib/browser/index.mjs`。

**影响**：这是一个**潜在**故障面而非活跃故障——当前仓内没有任何消费者在浏览器条件解析这两个包（`packages/web/client` 的 `LoaderService` 只按 entry URL 动态 `import()`，不做包解析；`plugins/webui/console/src/browser/index.ts` 是唯一被 `browser` 条件覆盖的消费者）。故本版把它从上一版的「待确认项」定性为「**已确认的移植缺口**」，待浏览器内运行 loader 的场景出现即会暴露。

**建议**：见 §6.3 P7——补回 `browser` 条件（与 `console` 同形），零运行时风险。

#### A4 跨包源码引用两种写法并存，且相对路径处的理由已过时

**现象**：`packages/web/client/src/` 引用同仓的 `@koishi-ce/components` 时，`.ts` 用相对路径穿越包边界、`.vue` 用包名。

**证据**：

| 文件 | 写法 |
|---|---|
| `src/components/index.ts`（2 处）、`src/components/icons/index.ts`、`src/plugins/setting.ts`、`src/plugins/theme.ts` | `from "../../../components/src/index.ts"` / `"../../../../components/src/index.ts"` |
| `src/components/dynamic.vue`、`src/components/perms.vue` | `from "@koishi-ce/components"` |

`src/components/index.ts` 处的注释理由是「`@koishi-ce/components` 的 exports 仅有 `source` 条件，浏览器侧 tsconfig 无法解析」——**该理由已不成立**：`packages/web/components/package.json` 的 `exports["."]` 现在同时有 `source` 与 `default`，`.vue` 两个文件正是按包名成功解析的实证。

**影响**：同一语义两种写法（新人无法判断该写哪种）；相对路径穿越包边界会让「改包名/改目录」变成静默的构建失败；注释与实然脱节，误导后续维护。

**建议**：见 §6.3 P8——统一为包名导入、删掉过时注释。

### 5.2 B 级：一致性问题

#### B1 `koishi.public` 声明与实际目录不符

**证据（2026-09-24 实测全表）**：

| 包 | 有 `client/` | 有 `dist/`（构建后） | `koishi.public` | 判定 |
|---|---|---|---|---|
| actions | 无 | 无 | `["dist"]` | **死声明**（声明了不存在的目录） |
| oobe | 无 | 无 | `["dist"]` | **死声明** |
| analytics | 有 | 有 | 无 | **漏声明** |
| status | 有 | 有 | 无 | **漏声明** |
| console | 无 | 有（宿主产物） | 无 | 待定（宿主是否应展示 `dist` 需产品判断） |
| 其余 14 个 | 有 | 有 | `["dist"]` | 一致 |

**影响**：`koishi.public` 被 `@koishi-ce/registry` 读取（市场元数据）。`actions` / `oobe` 声明了不存在的目录；`analytics` / `status` 有产物却未声明。npm 打包侧会静默忽略不存在的 `files` 项，故无构建故障，但属声明与实然脱节。`check:packages` 只覆盖依赖方向与包名纪律，**不检查该字段**。

**建议**：见 §6.2 P5——清掉 `actions` / `oobe` 的 `public`，为 `analytics` / `status` 补上，`console` 单独判断。

#### B2 测试文件放置三套并存，前端侧覆盖近乎空白

**证据**：Node 侧同时存在 `src/__tests__/*.test.ts`（auth / admin / config / console / logger / locales / actions）与 `src/*.test.ts`（commands / explorer / insight / notifier / sandbox / analytics / status / oobe）两种约定；前端侧 8 个测试文件全部平铺在源码目录：

```
packages/web/client/src/components/markdown.test.ts
packages/web/components/src/virtual/virtual.test.ts
plugins/webui/explorer/client/languages.test.ts
plugins/webui/market/client/{dependencies/dependency-groups,dependencies/dependency-helpers,dependencies/ignore-policy,extensions/uninstall,vendor/market/utils}.test.ts
```

**影响**：三套约定并存，新增测试时无判据；前端侧 249 个 `.vue` 组件对应 8 个测试文件（且集中在 market 的纯逻辑模块），覆盖率极低。

**建议**：统一为 `__tests__/` 目录（与最大既有群体一致），存量逐步迁移；前端侧的测试策略另行立项（改路径本身不会提升覆盖）。

#### B3 `client/` 内部组件与逻辑混排

**证据**：

- `packages/web/client/src/components/` 同层混放：组件（`dynamic.vue` / `perms.vue`）、纯逻辑模块（`link.ts` / `markdown.ts` / `slot.ts`）、测试（`markdown.test.ts`）、目录（`chat/` / `common/` / `icons/` / `layout/`）。
- `packages/web/components/src/` 同层混放：平铺组件（`image-viewer.vue` / `k-comment.vue`）、样式（`index.scss` / `viewer-toolbar.scss`）、构建载体（`schemastery-vue-{client,runtime}.ts`）、目录（`form/` / `virtual/`）。

**影响**：`components/` 目录同时承担「组件集合」与「若干纯函数工具」两种职责；两个包的 `src/` 根组织风格不同（一个目录化程度高、一个平铺为主）。

**建议**：见 §6.2 P6（纯本仓范围，不影响上游同步）。

#### B4 `src/` 入口形态两套

**证据**：`config` / `console` / `market` 采用 `src/{node,browser,shared}/` + `src/index.ts` 占位桥接（文件内注明 `placeholder file, do not modify`）；其余 16 个为扁平 `src/index.ts`。`config` 的 `exports` 额外暴露 `./shared`（唯一子路径导出）。

**影响**：同一架构两种写法，读者需要判断「这个包的 `src/index.ts` 是真入口还是转发」。占位桥接本身是必要设计（保证 `exports` 的 `.` 条件稳定并与 `browser` 条件配合），但缺少文档说明。

**建议**：文档说明占位桥接的用途与适用条件（何时该拆 node / browser / shared），不强行统一。

#### B5 浏览器端 console 类型面靠 16 处手写镜像，无同步门禁

**证据**：全仓 17 处 `declare module "@koishi-ce/plugin-console"`，其中前端侧 16 处：

- `packages/web/client/src/index.ts`、`packages/web/client/src/shims.d.ts`（手写 console 骨架：`ClientConfig` / `Events` / `Console.Services` / `DataService`）；
- 各插件 client 14 处：admin（`client/shims.d.ts`，专为 `Events` 镜像而建）、analytics / auth / commands / config / dataview / explorer / insight / locales / logger / market / notifier / sandbox / status；
- 其中 `dataview/client/console-services.ts` 与 `market/client/console-services.ts` 是**专门的镜像文件**（含 `DbEvents` / `Dependency` / `Dict` 的内联镜像）。

**根因（已记录在案）**：TS7 的跨文件 `declare module` 增强对经 lib 产物 d.ts 的模块骨架不生效，node 侧 Events / Services 声明变更时须手工同步镜像。

**影响**：node 侧改一个事件签名，前端不会报错，运行时才失效；16 处镜像没有任何门禁或对账测试。

**建议**：见 §6.3 P9——至少为两个 `console-services.ts` 的镜像载荷加一条对账断言（其余散落声明数量大，可先只登记不治理）。

### 5.3 C 级：命名与细节

| 编号 | 现象 | 证据 | 建议 |
|---|---|---|---|
| C1 | 唯一未带 `k-` 前缀的全局组件：`virtual-list`（`packages/web/*` 对内对外导出的其余组件已全部 `k-*`：`k-activity-link` / `k-button` / `k-card` / `k-comment` / `k-content` / `k-empty` / `k-filter` / `k-hint` / `k-image-viewer` / `k-layout` / `k-markdown` / `k-slot` / `k-slot-item` / `k-status` / `k-tab` / `k-tab-group` / `k-tab-item`） | `packages/web/components/src/virtual/index.ts` | 约定：`packages/web/*` 对外导出的组件一律 `k-`；`virtual-list` 是上游既有公开名，改名属破坏性变更，**登记为已知例外**即可 |
| C2 | `plugins/webui/locales` 包内的 `client/locales.vue` 与仓库 19 个 `locales/` 目录同名，全文搜索噪声大 | `plugins/webui/locales/client/locales.vue` | 不改（包名是上游映射的一部分），在本表与速查表标注 |
| C3 | 产物目录与源码目录同层（`client/` `dist/` `lib/` `src/` 并列于包根） | 全部 `plugins/webui/*` | 属上游约定与发布形态所需，不动 |
| C4 | 宿主产物落点硬编码在另一个包内 | `builder/src/assemble.ts` 的 `${cwd}/plugins/webui/console/dist` | 已在 §4.2 钉死；改动会同时影响 console 包与本仓命令，动前先读 `assertRepoLayout()` |
| C5 | `eslint.config.ts` 的 `apps/online/app/**/*.vue` 是**死 glob** | 目录 `apps/online` 已删除（[../process/upstream.md](../process/upstream.md) 巡检记录：webui `packages/online` 有意不入范围） | 删除该行；`lint:client` 的 npm 脚本（`packages/web/*/src` + `plugins/webui/*/client`）才是活的 |
| C6 | 许可声明漏 `packages/web/builder` | `NOTICE` 的 Provenance 表与 [../reference/architecture.md](../reference/architecture.md) §6 都只列 `packages/web/{app,client,components}`；而 builder 全部源文件带 `AGPL-3.0-only` 头，`AGENTS.md` 硬约束 6 亦声明 `packages/web/*` 全部 AGPL | 把 `packages/web/builder` 补进两处许可表 |
| C7 | `market/client/` 内嵌套三个易混子目录：`market/`（4 视图）、`components/`、`vendor/market/` | `plugins/webui/market/client/market/list.vue` | 不改（对齐上游 market v2.11.11 布局），在速查表标注 |
| C8 | 前端三个包都带 `*.d.ts` 垫片但职责不同，命名未区分 | `app/src/shims.d.ts`（引用 `@koishi-ce/client/global`）· `client/src/shims.d.ts`（手写 console 骨架）· `client/global.d.ts`（对外发布）· `components/src/shims.d.ts` | 不改路径；新增垫片前先读 §4.4 与 B5 |

---

## 6. 整改建议

### 6.1 已核销（旧版 §5 方案与本版复核结果）

| 旧版条目 | 状态 | 落地内容 |
|---|---|---|
| §5.1 P1 拆分 `packages/web/client` | ✅ **已完成**（两步，均已并入 `main`） | 第一步拆出 `packages/web/builder`（`@koishi-ce/console-builder`，node 侧构建器 + `koishi-console` CLI + 宿主总装）；第二步拆出 `packages/web/app`（`@koishi-ce/console-app`，宿主 SPA）。三个浏览器侧包源码目录统一为 `src/`，`@koishi-ce/client` 收窄为纯浏览器运行时库。两批 changeset 仍在 `.changeset/` 待消费 |
| 旧版 A1「四职责同包」 | ✅ 消失 | 见上 |
| 旧版 C1「`app/` 与 `client/` 命名撞车」 | ✅ 消失 | `app/` 成为独立包（`packages/web/app`），不再与 `client/` 同层 |
| 旧版 B5「`files` 含不存在路径」 | ✅ 已清 | `packages/web/components` 的 `tsconfig.client.json` 死项、`plugins/webui/console` 的 `app` 死项均随拆分删除；现 4 个 web 包的 `files` 全部与实存目录一致 |
| 旧版 B4「`welcome/build/` 空目录」 | ✅ 已清 | 目录不复存在；`plugins/webui/*/build/` 现仅剩 `analytics/build/client.ts` 一个真实构建钩子 |
| 旧版 C2「组件 `k-` 前缀不统一」 | ⚠️ 基本解决 | `card` / `content` / `empty` / `tab-group` / `tab-item` / `perms` / `dynamic` 已随拆分统一为 `k-*`；仅剩 `virtual-list`（C1） |
| 旧版「eslint 漏检宿主 `.vue`」 | ✅ 已补 | `eslint.config.ts` 与 `lint:client` 的 glob 已改为 `packages/web/*/src/**/*.vue`，宿主 SPA 纳入检查 |

**未核销**（旧版 §5.2 优先级表中排 1-5 的项）：P5 的 `koishi.public` 部分（本版 B1）、P3 locales 纪律、P4 概念词典、P2 icons 去重、P6 components 收拢——均仍成立，理由与做法基本不变，见 §6.2。

### 6.2 仍待办（旧版方案，本版复核后维持）

#### P2（短期）：消除 icons 重叠

只处理 `packages/web/client/src/components/icons/` 与 `plugins/webui/market/client/vendor/market/icons/misc/` 的 5 组重名（`star-empty` / `star-full` / `tag` / `file-archive` / `search`）。注意两者是**两套不同的注册机制**（`icons.register(name, comp)` vs 自带 `name` prop 的独立 registry 组件），收敛意味着 market 侧的这 5 个图标改走 `@koishi-ce/client` 的 `icons` 注册表并改造调用点；插件自带 `icons/` 不动（上游约定）。

#### P3（短期，零代码风险）：locales 纪律化

不改路径（避免上游 diff 噪声），改为：

1. 在本文 §3.6 与 [../reference/architecture.md](../reference/architecture.md) 钉死：`locales/` 供 Node 侧、`client/locales/` 供浏览器侧；
2. 扩展 `tooling/checks/locales.ts`：当某包两侧 `locales` 同时存在时，校验两侧键集一致（当前只做了目录内的语种与键对齐）；
3. `market` 的 `message.*` / `schema.*` 双命名维持既有豁免登记。

#### P4（短期，零代码风险）：概念词典

把本文 §3.7 的表格（`client/` / `src/browser/` / `dist/` / `app/` 五词辨析）复制进 `docs/guides/development.md` 的「前端目录语义」小节，并在 `config` / `market` 的 `src/browser/index.ts` 头部注释写明加载路径与用途。

#### P5（短期）：清理声明与残留

- 清 `actions` / `oobe` 的 `koishi.public`，补 `analytics` / `status`，判断 `console`（§5.2 B1）；
- 删 `eslint.config.ts` 的 `apps/online` 死 glob（§5.3 C5）；
- 把 `packages/web/builder` 补进 `NOTICE` 与 architecture.md §6 的许可表（§5.3 C6）。

#### P6（可选）：`src/` 内收拢逻辑模块

`packages/web/client/src/components/` 增设 `logic/` 收纳 `link.ts` / `markdown.ts` / `slot.ts`；`packages/web/components/src/` 增设 `common/` 收纳两个平铺组件与样式。纯本仓范围，风险低。

### 6.3 新增建议

#### P7（短期，推荐）：补回 `config` / `market` 的 `exports.browser` 条件

与 `console` 同形（`"node": {"import": ..., "default": ...}` + `"browser": "./lib/browser/index.mjs"`）。零运行时风险（当前无消费者），收益是恢复上游协议、消除潜在故障面。落地前顺带确认 `tsdown` 对 `src/browser/index.ts` 的入口切分（参照 `plugins/webui/console/tsdown.config.ts` 的三入口写法）。

#### P8（短期）：统一跨包源码引用为包名

把 `packages/web/client/src/` 的 4 处 `../../../components/src/index.ts` 改为 `@koishi-ce/components`，删掉过时注释（§5.1 A4）。改后须跑 `bun run typecheck` 与 `bun run build`——`.vue` 两个文件已实证按包名可解析，风险集中在 `tsconfig.web.json` 是否需要补一条 paths（若 typecheck 报 TS2307，补 `"@koishi-ce/components": ["./packages/web/components/src/index.ts"]` 即可，与 `schemastery-vue/client` 同理）。

#### P9（可选）：给两处 `console-services.ts` 镜像加载荷对账

`plugins/webui/{dataview,market}/client/console-services.ts` 内的 `DbEvents` / `Dependency` 等镜像与 node 侧声明「严格同步」靠人工。可仿照 `@koishi-ce/plugin-config/client` 的类型引用方式（`tsconfig.web.json` 的 paths 已指向 lib 产物 d.ts）改为 import 而非内联复制，或加一条对账断言。其余 14 处散落的 `declare module` 数量大、收益低，本版只登记不治理。

### 6.4 优先级

| 顺序 | 条目 | 收益 | 代价 | 风险 | 前置依赖 |
|---|---|---|---|---|---|
| 1 | P5 声明与残留清理 | 中 | 低 | 极低 | 无 |
| 2 | P3 locales 纪律化 | 中 | 低 | 低 | 无 |
| 3 | P4 概念词典 | 高（认知） | 极低 | 无 | 无 |
| 4 | P7 补 `browser` 条件 | 中（防潜在故障） | 低 | 低 | 确认 tsdown 入口切分 |
| 5 | P8 统一跨包引用 | 中（一致性） | 低 | 低 | typecheck 复核 |
| 6 | P2 icons 去重 | 中 | 中 | 低 | 确认 market vendor 的调用点改造范围 |
| 7 | P6 `src/` 收拢 | 低 | 低 | 低 | 无 |
| 8 | P9 镜像对账 | 低 | 中 | 低 | 无 |

### 6.5 不建议做的事

| 想法 | 否掉的理由 |
|---|---|
| 把各插件 `client/icons/` 集中到统一图标包 | 违背上游约定，插件前端将失去自洽性；每次上游同步都会产生无意义的 diff |
| 统一 `locales/` 与 `client/locales/` 的物理路径或改名 | 同上，且会打断 `loader` 的 `copy` 规则与既有词典体系 |
| 把 market vendor 树的 `outline/` 与 `solid/` 合并 | 两套线型是设计意图（15 组「同名」属正常） |
| 改 `packages/web/{app,client,components}` 的源码目录名回 `client/`（对齐上游） | 会推翻「全仓包的源码一律 `src/`」这一唯一命名收敛，得不偿失；代价已在 [../process/upstream.md](../process/upstream.md) 用「单边清单 + 手工对位」显式承接 |
| 给前端引入 vite 配置文件 | 现有编程式构建是三处显式接线的结果（总装、单插件、dev server），改配置文件会引入「哪份配置生效」的新歧义 |
| 重命名 `dist/` / `lib/` / `src/` | 与上游映射、发布 `files`、类型 paths 强耦合，收益不抵成本 |
| 把 `plugins/webui/*/src/` 统一改造成 node/browser/shared 三分 | 16 个扁平包的 `src/index.ts` 是真实入口，改造为零收益的结构变动（`browser` 条件缺失是另一回事，见 A3/P7） |
| 合并 `locateApp()` 与 console devMode 的等价解析 | 两者物理上不可合并（builder 顶层 `import * as vite`，console 生产路径不得静态引 builder）；保持两处 + 双向注释指路即最优 |

---

## 7. 附录：职责速查表

一张表回答「这个目录是干什么的」（前向引用本文 §3）。

| 路径 | 一句话职责 | 修改前须知 |
|---|---|---|
| `packages/web/app/src/` | 宿主控制台 SPA 源码（`@koishi-ce/console-app`，`src/` 即 vite root） | 改动影响总装产物与 devMode；`src/index.ts` 是唯一入口；`exports` 只暴露 `./package.json` 是定位协议，勿加别的入口 |
| `packages/web/client/src/` | 对外浏览器运行时库源码（`@koishi-ce/client` 默认入口） | 是下游 API 面，命名与导出变更需谨慎；`client.js` 共享块由总装产出 |
| `packages/web/components/src/` | 共享组件库（表单 / 虚拟列表 / 展示件） | 无构建，改源码即改宿主产物；`index.ts` 刻意不直接 `export * from "cosmokit"`（见该文件头注释） |
| `packages/web/builder/src/index.ts` | 编程式构建器与 `koishi-console` CLI（`@koishi-ce/console-builder`） | 改动影响全部插件的前端构建与 devMode |
| `packages/web/builder/src/app.ts` | 宿主 SPA 定位唯一入口（`locateApp()`） | 改包名或应用子路径须同步 console 的 devMode 分支 |
| `packages/web/builder/src/assemble.ts` | 宿主总装（CLI 无参分支） | 改产物落点会同时影响 console 包与本仓命令；只能在仓库内执行 |
| `packages/web/client/global.d.ts` | 对外发布的浏览器全局类型垫片 | 被 `tsconfig.client.json` 的 `files` 引用，下游经 `@koishi-ce/client/global` 消费 |
| `plugins/webui/*/client/` | 插件前端实现（Vue + UI 注册） | 入口固定 `client/index.ts`（多一个文件也会被构建发现）；**该子路径是跨插件公开面，不改名** |
| `plugins/webui/*/client/locales/` | 插件前端词条 | 与包根 `locales/`（Node 侧）分离，见 §5.1 A2 |
| `plugins/webui/*/build/client.ts` | 可选 vite 配置覆盖 | 文件名固定，vite 不自动发现，靠 `build()` 显式加载；当前仅 analytics 使用 |
| `plugins/webui/*/dist/` | 插件前端产物（`index.js` + `style.css`） | 由构建生成，勿手改 |
| `plugins/webui/*/locales/` | 插件 Node 侧词条 | 同上 |
| `plugins/webui/*/src/browser/` | Node 侧插件的浏览器环境变体（与 UI 无关） | `config` / `market` 的 `exports` 未声明 `browser` 条件（§5.1 A3）；`console` 已声明 |
| `plugins/webui/*/client/{shims.d.ts,console-services.ts}` | console 类型面的浏览器侧手写镜像 | 与 node 侧声明**严格同步**，无门禁（§5.2 B5） |
| `plugins/webui/market/client/vendor/market/` | 自 `@koishijs/market` 4.2.10 vendor 的客户端逻辑层与图标 | 同许可；`icons/outline` 与 `icons/solid` 的同名是设计意图 |
| `plugins/webui/console/dist/` | **全部**控制台前端产物（宿主 + 各插件） | 宿主总装与单插件构建共用该目录；调试时注意清空时机 |
