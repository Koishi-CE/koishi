# client 端全量结构（旧 client 底册）

> 状态：考据文档。对象是旧 `参考/client/`（P4 移植底册，即旧 `Waiting_refactored/client/`），逐文件说明组件/模块/i18n/彩蛋；P6 删除旧码后本文是唯一参照。
>
> **路径与行号体系（P6 勘误）**：本文有三层对应关系——①文中路径是 P4 移植时点的"新布局"名（`components/utils.ts`→`shared/operations.ts`、根 `utils.ts`→`shared/plugin-config.ts`、`components/X.vue`→`pages/*/X.vue` 或 `dialogs/X.vue`、`composables/`→`pages/dependencies/`）；②行数与行内行号对应 `参考/client/` 的实际旧文件（参考目录本身仍是 components/ 旧布局：`components/utils.ts` 531 行、根 `utils.ts` 429 行等）；③参考目录在本文初稿后又经历了一轮自身拆分（`client/index.ts` 420 行 → 45 行 + `actions.ts` 96 行 + `pages.ts` 96 行 + `registry-state.ts` 96 行 + `i18n.ts` 等），§1 的 420 行版本时序描述对应拆分前的大文件。当前（重构后）`client/` 又在 P4 布局基础上把 `shared/operations.ts`、`shared/plugin-config.ts` 拆成了目录、大组件拆出 use-* composables；检索以组件/符号名为准。

# 1. 入口与路由 — `client/index.ts` (420 行)

**模块声明 (26-48)**：向 `@koishijs/client` 扩展 `Config.market`（MarketConfig：bulkMode、removeConfig、updateIgnore*、gravatar、search.{endpoint,timeout,autoRoute,logLevel}）和 `Store.marketData`（override / updateIgnored / bundleRecords / collapsedGroups）与 `Store.dependencies`（request/resolved/workspace/source/local/bound/invalid/latest）。`registryStatus` 未声明在 Store 接口里，而是用 `MarketStore` 类型断言挂到 store 上 (66-68)。

**顶层副作用 (104-127)**：三个 `receive()` 广播监听：`market/registry`（合并 store.registry）、`market/registry-status`（合并 + sweep 超时置错，常量 120s 超时 / 15s sweep，73-74）、`market/registry-status/clear`。

**插件默认导出 (129-420) 内部时序**：
- 130 `registerMarketNextI18n(ctx)` 注册 i18n
- 132-138 devMode 下注册/销毁耗时日志
- 142-150 watch：`store.market?.data` 若为 reactive 则 `markRaw(toRaw())`（防止市场索引被深度代理）；`store.market` 变化时 `restoreMarketSnapshot()`
- 152-157 watch `store.market?.dataVersion` 变化 → `refreshMarketLookups()`
- 159-196 April fools / Koishi Day 彩蛋：`isAprilFoolsDay()`(4月1日)、`isKoishiDay()`(5月14日)，每 60s 轮询刷新图标；在 `/dependencies` 页面监听 Alt+G → Alt+B（1.5s 内连按，常量 75 行）强制 `forcedAprilFoolsIcon`，使 "upgrade all" 菜单图标变炸弹
- 198-201 每 15s `sweepRegistryStatus()` 定时器
- 203-212 `welcome-choice` slot：欢迎页"添加插件市场"入口，点击跳 `/market`
- 214-242 六个 `global` slot：Install、BundleInstall、Confirm、InstallProgress、InstallHistory、EnvironmentVersions（全部全局挂载的对话框）
- 244-253 `ctx.page` 注册 `/market`（id=market，icon `activity:market`，order 750，authority 4，fields:['market']，component=`createPageBoundary('Market', Market)`）
- 255-259 `extensions(ctx)`（try/catch 包裹）
- 261-274 刷新反馈状态（refreshingMarket/refreshingDependencies/pendingMarketRefreshFeedback + finishMarketRefreshFeedback）
- 276-293 `if (!global.static)`：`status-right` slot 挂 Progress(order 10)；`ctx.page` 注册 `/dependencies`（id=dependencies，icon `activity:deps`，order 700，fields:['dependencies','registry','registryStatus']，GuardedDependencies）
- 295-348 五个 `ctx.action`：`market.refresh`（ctrl+r，按当前 activity 分流 market/refresh 或 market/refresh-dependencies）、`market.install`（打开 showConfirm）、`dependencies.manual`、`dependencies.history`、`dependencies.versions`
- 350-359 `ctx.menu('market')`：.install / .refresh（spin 状态）
- 361-395 `ctx.menu('dependencies')`：.upgrade（图标随 April fools/Koishi Day 切换 bomb/koishi/rocket）、market.install、.manual、.history、.versions、market.refresh
- 397-412 watch `store.dependencies`：清除已落地的 override 并 `patchMarketNextData({override})`
- 414-419 watch `store.market?.refreshing` 完成时给出刷新成功/失败 toast

**页面边界 `client/shared/page-boundary.ts` (36 行)**：`createPageBoundary(page, component)` 返回包装组件，`onErrorCaptured` 捕获渲染错误后显示 k-empty + 重试按钮（revision++ 重新挂载）。

# 2. 大组件内部职责分解

## pages/dependencies/package.vue (1698 行) — 依赖卡片/列表行（单个包）
- **模板 1-263**：三种形态：list row 模式 (3-48)、card 模式 (51-193)；内嵌三个对话框：忽略更新对话框 (195-238)、本地绑定确认对话框 (240-256)、bundle-uninstall 复用 (258-262)
- **script 265-910**：
  - props：name / kind / listMode (282-286)
  - 数据源 computed (311-326)：dep、local、localDependency、marketData（getMarketObject）、bundleRecord、bundleOrigin、displayName、data（analyzeVersions 结果）
  - 版本/覆盖逻辑 (340-382)：latestVersion、overrideValue、pending、pendingRemove、updateCheckDisabled、ignoredUpdate、updatable、bundlePackage、unconfigured、selectedVersion（双向 computed，写 getPendingOverrides + patchMarketNextData）
  - 状态机 (384-434)：statusClass（pending/local/invalid/bundle/unconfigured/error/manual/check-disabled/ignored/updatable/installed 11 态）、statusLabel、statusIcon、badgeIcon、markIcon
  - 文案 computed (436-530)：currentText、targetText、targetLabel、detailText、compactStatusText、configText、sourceText、removeButtonText、requestText、versionSourceText
  - 身份/分类 (532-543, 856-892)：identity（resolveIdentity 按包名正则猜类别）、identityText/identityIcon/cardStyle（--dep-accent 着色）、identityMap（17 个类别→label/icon/color）
  - 可见性开关 computed (544-630)：showIdentityPill…showCardActions、floatingActions、editToggleText、canExpandCard、showQuickUpdate、showInlineIgnoreUpdate、showRestoreUpdate、showConfigure、showBindLocal、showRemoveDependency
  - 交互函数 (632-708)：toggleCardActions、toggleEdit、openBundlePanel（设 activeBundle）、clearOverride（连带清理 pendingBundleUninstalls 成员）、removeDependency（bundle 走卸载对话框）、openLocalBinding、confirmLocalBinding（后端 `market/prepare-local-binding` + 保存 override）
  - 忽略更新对话框逻辑 (710-825)：openIgnoreDialog、confirmIgnoreUpdate（永久忽略→updateIgnoredPackages 名单；限时→createUpdateIgnoreRule）、getDurationPreset、getDialogDuration、normalizeDialogCount、addPackageToIgnoredList、restoreUpdate、persistUpdatePolicy（patchMarketNextConfig + patchMarketNextData）、removePackageFromIgnoredList
  - 工具函数 (827-900)：isPluginPackage、formatPackageDisplayName、pickDescription（按 locale 选描述）、formatEndpoint、configure（ensureInstalledConfig）
- **styles 913-1698**：全局对话框样式（913-1068，含 polished 模式变体）+ scoped 卡片/列表行样式（1070-1698，含 768/420px 响应式）

## dialogs/bundle-install/index.vue (1386 行) — Bundle 安装面板
- **模板 1-328**：el-dialog（由 activeBundle 控制）；hero 头 (11-31)、loading/error (34-40)、统计条 (46-60)、校验错误/警告 (62-67)、批量操作行 (70-81)、必选成员列表 (84-180)、可选成员列表 (183-283)、可视化 diff（install/config/move/skip 四象，285-317)、footer 安装按钮 (321-326)。成员行内含：createConfig/move/usePreset 复选框、冲突告警（package-mismatch/other-config/same-group）、敏感字段编辑器（show-password 输入）、预设 JSON textarea 编辑器
- **script 330-720**：
  - 本地状态 (360-372)：loading/installing/error/registry/bundle/resolvedBundleVersion/members(reactive)/ctx/config/modeClass
  - computed (374-453)：title、bundleVersion、validation（validateBundleManifest）、validationErrors/Warnings、selectedMembers、requiredMembers、optionalMembers、progressPercent、allOptionalSelected、installList/configList/moveList/presetList/skippedConfigList（diff 数据）、canInstall（JSON 无错 + 校验通过）
  - `watch(activeBundle)` (455-518)：核心加载流程——`send('market/package')` 拉取 registry → parseBundleManifest → loadMarketObjects → 逐成员 getBundleMemberConfigState 判冲突 → 初始化 members 选中态 → 缺失的 registry 用 `market/registry` 批量补
  - 成员信息展示函数 (520-588)：memberInfo、getPackageDescription（多语言描述）、formatUser/getAuthor/getMaintainer、getInstalledText、versionMeta、riskTags（verified/insecure/deprecated/preview/portable/hasPreset/marketMissing）、hasPreset、sensitiveFields（scanSensitiveConfig）、formatConfig
  - 交互 (590-616)：toggleMember、close、batchSetCreateConfig、batchSetUsePreset、toggleAllOptional
  - `confirmInstall` (618-698)：组装请求 → 直接驱动 installProgressState（不经过 utils 的 install()）→ `send('market/install-bundle')`，带 socket 断连竞速（watch(socket) + Promise.race）、8s 等待提示、失败时 `prepareInstallFallbackRetry`
  - 错误格式化 (700-718)：reportInstallError、formatInstallError
- **styles 722-1386**：面板全套样式（bundle 紫色主题、滚动条、成员卡、diff 网格等）

## pages/dependencies/dependencies.vue (1193 行) — /dependencies 页面
- **模板 1-119**：工具栏（filter 下拉、blockPreview 切换、grid/list 布局切换、搜索框、摘要 chips，3-51）、分组列表（可折叠 group header + deps-grid/package-view，53-104）、底部 pending 应用栏 (107-116)、manual-install (118)
- **script 121-409**：
  - 类型 (134-152)：FilterKey / ItemKind / DependencyItem / DependencyGroup
  - 布局状态 (157-163)：keyword、filter、frontendMode/depsLayout/modeClass/layoutClass
  - `names` computed (177-200)：合并 store.dependencies + override + 从 store.packages 发现的（未配置插件、bundle、shouldIncludeDiscoveredLocalPlugin 判定）
  - watch (202-219)：names→loadMarketObjects；store.market?.registry 出现后 watch override，为不在 dependencies 的名字 addManual
  - 生命周期 (221-236)：onMounted/onBeforeUnmount 注册 Ctrl+K 聚焦搜索快捷键
  - `classify()` (238-254)：把包分到 11 种 ItemKind 的核心分类函数；isPluginPackage (256)、isUnconfigured (260)
  - `items`/`updates`/`prereleaseBlocked`/`summary`/`refreshing` computed (265-298)
  - `filterOptions` (300-312)、`groupMeta`（i18n 分组元数据，314-326）、`groupOrder` (328)
  - 折叠状态 (330-347)：collapseEnabled/getDefaultCollapsed/isGroupCollapsed/toggleGroup（持久化到 collapsedGroups）
  - `toggleLayout` (349-356)：grid/list 切换，写 config + patchMarketNextConfig
  - `visibleGroups` (358-378)：按 filter + keyword 分桶到 group
  - `clearChanges` (380-384)、`togglePrereleaseFilter` (386-395，updateIgnorePrerelease 持久化)
  - `ctx.action('dependencies.upgrade')` (397-407)：一键把所有 updatable 写入 override
- **styles 411-1193**：工具栏/分组/卡片网格/列表布局/apply-bar + polished 模式大段视觉样式

## pages/market/market.vue (1060 行) — /market 页面
- **模板 1-122**：k-layout（左侧 #left 挂 market-filter）；三种主体：加载中 spinner+慢加载警告（可跳设置，9-28）、正常（market-search + 彩蛋 market-secret-archive 或 market-list，30-105）、错误态 k-comment（107-120）。market-list 的 header slot 里含：结果统计、缓存 stale/cached 提示、debug 信息卡（对象数/解码大小/压缩比/候选端点/timings/阶段/路由评分，49-95）；action slot 是安装/编辑按钮 (96-103)
- **script 124-503**：
  - `installed()` 判定 (143-149)；provide(kConfig) (164-166)
  - 搜索词 `words` (168)；`prompt` (170)
  - **秘密档案彩蛋** (172-191)：`secretSearchMatched`——搜索内容含 "恋恋"+"世界第一" 时切换为 market-secret-archive 视图，记录 recordedAt 并滚回顶部
  - 数据链 (193-212)：data（getMarketSnapshotData）→ silentData（getSilentFiltered 静默过滤规则）→ visibleData（getVisible + show:hidden/show:deprecated）
  - 加载状态 (214-247)：clientDebug、marketLoading、loadingSlow、loadingEndpoint/Timeout/AutoRoute、showMarketCacheHint
  - debug 展示 computed (249-292)：debugItems/debugTimings/debugPhases/debugRoutes
  - 路由同步 (294-316)：双向同步 `?keyword=` query ↔ words（180ms 防抖 replace）
  - watch (318-327)：marketLoading→慢加载警告调度；dataVersion→loadMarketSnapshot
  - 生命周期 (329-353)：onMounted 调度慢加载警告 + Ctrl+K / Escape（彩蛋激活时清空搜索）快捷键 + loadMarketSnapshot；onUnmounted 清理
  - 按钮状态函数 (363-385)：getType/getText（按 installed + override 值给出 success/warning/danger/primary 与文案）
  - `openPackage` (387-393)：bundle 包→打开 activeBundle（bundle-install 面板），否则 `active.value = name`（install 面板）
  - 格式化工具 (399-501)：formatTime、updateClientDebug、formatSource/formatTimingName/formatDuration/formatDebugPhase/formatFallbackReason/formatSize/formatEncoding/formatCompressionRatio/shortEndpoint/formatScore/formatNumber（全部服务 debug 卡）
- **styles 505-1060**

## 中小组件
- **dialogs/install/index.vue (733 行)**：单包安装/卸载对话框（由 `active` 控制，global slot）。模板 1-134：头部版本选择 (7-19)、danger/warning 提示 (22-31)、peer 依赖表格（可内联选版本的 frameless el-select，33-84)、footer（bulkMode 复选框、本地包 configure、移除/安装按钮，86-108）、移除配置二次确认小对话框 (111-127)、bundle-uninstall (129-133)。script 136-440：`installDep()` (169-223)——bulkMode 下只写 override；否则处理 remove-config 记忆 + 调 `install(versions, callback)`（安装后 ensureInstalledConfig / 移除配置 / 清 bundleRecords）；`versions` reactive 表 (237) 与 getOverride 分流 (239-255)；peer 版本选择 (257-269)；unchanged/dep/current/local/bundleUninstallRecord/showRemoveButton/workspace/localSelection computed (271-298)；`requestRemove` (300-310，bundle 转 bundle-uninstall)；`getWorkspaceVersion` (312-321)；data=analyzeVersions (323-326)；registryStatus/Text (328-330)；danger（deprecated/insecure）/warning（跨 major）/result computed (332-358)；两个 watch：peers 变化→补拉 `market/registry` + 自动选 peer 版本 (366-392)、active 变化→初始化版本并发 `market/registry` (394-410)；getResultIcon/getResultText (421-438)。styles 442-733。
- **dialogs/install-progress/index.vue (412 行)**：安装进度终端对话框（global slot），纯展示 `installProgressState`。模板 1-74：状态横幅（running/success/error）、伪终端日志滚动区、footer 的 fallback 端点重试按钮。script 76-136：statusText computed（区分 selfUpdate/environmentRestore × 状态）、日志自动滚底 watch、handleBeforeClose（running 时禁止关闭）、retryFallback。styles 138-412。
- **dialogs/install-history/index.vue (772 行)**：安装历史双栏对话框。模板 1-103：左侧记录列表（状态点/标题/包名/时间），右侧详情（元信息、版本变更 before→after 列表、复制日志按钮）。script 105-264：loadHistory→`market/install-history`(20 条)、selectEntry→`market/install-history-detail`（串号防竞态 detailSerial）、copyLog（clipboard + execCommand 降级）、historyTitle（统计安装/更新/卸载数）、格式化函数。styles 266-772。
- **dialogs/environment-versions/index.vue (641 行)**：环境快照管理双栏对话框。模板 1-113：快照列表（current 标记）、diff 预览（orderedChanges 排序 unsupported→removed→downgrade→upgrade→added→changed→unchanged）、恢复确认小对话框。script 116-249：loadSnapshots→`market/environment-snapshots`、selectSnapshot→`market/environment-snapshot-preview`（previewSerial 防竞态）、canApply、applySnapshot→`applyEnvironmentSnapshot(id, selfUpdate)`（检测是否包含本插件自身）、状态文案函数。styles 251-641。
- **dialogs/bundle-uninstall/index.vue (521 行)**：bundle 卸载对话框（被 package.vue / install.vue / version.vue / bundle-group-uninstall.vue 复用，props: modelValue/packageName/record/title/redirectToPlugins）。模板 1-92：成员列表（每成员三选一 radio：清组配置/删依赖/保留）、批量操作条、汇总、fallback 记录警告。script 94-300：protectedDeps 保护集 (112)、memberRows computed（installed/hasGroupConfig/hasExternalConfig/canRemoveDependency，161-178）、三个计数 computed (180-190)、loadRecord（fetchBundleRecord 补拉远端记录，203-216)、getDefaultAction (230-235)、uninstallBundle (248-298)——bulkMode 下写 override + pendingBundleUninstalls 暂存；否则 `install(override)` 后 `market/remove-bundle-configs` + 清 bundleRecords + 可选跳转 /plugins。styles 302-521。
- **manual.vue (364 行)**：手动安装对话框（local 上传 / registry 包名两 tab）。模板 1-101：local tab 委托 local-package-upload 组件、registry tab（debounce 查询 addManual 显示 dist-tags 预览）。script 103-204：useLocalPackageUpload composable 接管上传状态；registryInvalid computed、fetchRemote（useDebounceFn 500ms）、onRegistryEnter（写 override latest + patchMarketNextData）、resetRegistry。styles 206-364。
- **dialogs/confirm/index.vue (358 行)**：批量变更确认对话框（showConfirm）。模板 1-42：变更表（名称/旧版本→新版本）。script 44-123：`confirm()` (72-121)——区分 selfUpdate、removed 列表、bundleRemovals；调 `install(override, callback)`，callback 内 ensureInstalledConfigs + `market/remove-bundle-configs` + 可选 configWriter.remove + 清 bundleRecords/override。styles 125-358。
- **market-secret-archive.vue (277 行)**：彩蛋视图（"秘密档案"），展示 koishiVersion / recordedAt / 插件数元信息 + i18n `marketPage.easter.secretSearch` 分段渲染的 k-markdown 文案；动画就绪后分段 reveal。props: koishiVersion/marketCount/recordedAt。script 60-88。
- **local-package-upload.vue (348 行)**：纯展示组件——拖拽/点击上传 .tgz 的 dropzone、上传进度、预览卡（名称/版本变化/SHA-256/脚本警告）。props 全部由 manual.vue 传入；emit error/select。script 77-120+。
- **dialogs/progress/index.vue (37 行)**：status-right 槽位的进度条，读 `store.market.progress/total`（市场索引加载进度）。
- **koishi-eye-splash.vue (229 行)**：见第 6 节。

# 3. client/market/ 模块（已拆分的新结构）

- **market/index.ts (9 行)**：聚合出口——`MarketIcon`（icons/index.ts）、`MarketFilter/MarketList/MarketSearch/MarketPackage`（components/*），并 `export * from './utils'`。
- **market/state.ts (306 行)**——市场快照与按需查找状态：
  - 导出 refs：`marketSnapshot`(shallowRef)、`marketSnapshotLoading/Error`、`marketLookupData`、`marketLookupServices`
  - `loadMarketSnapshot(force)` (117-173)：请求 `market/index`（优先 `transport:'http-gzip'` 走 fetch(url, force-cache)，失败降级 inline；62-95）；superseded 竞态检测（dataVersion 比对，最多重试 3 次）；`publishSnapshot` (42-56) 会同时写回 `store.market`（保持旧消费者兼容，data 均 markRaw）
  - `loadMarketObjects(names)` / `loadMarketServiceProviders(names)` (175-185)：按需 `market/lookup`
  - `refreshMarketLookups()` (187-198)：dataVersion 变化后重放所有已请求的 names/services
  - `receive('market/patch')` (296-306)：增量合并快照
  - `restoreMarketSnapshot()` (109-115)：store.market 被 Console 重置时回填 data
- **market/utils.ts (863 行)**——纯逻辑工具集，导出：
  - `useMarketI18n()` (14)：给 `market.*` 前缀的 t 函数
  - 用户/头像：`getUsers/getUserKey`、`getUserAvatarCandidates/getUserAvatar`（gravatar/cravatar/npm-avatar 候选链，75-147）、头像缓存（`cacheAvatarFailure/isAvatarFailureCached/getCachedAvatar/getCachedAvatarFromCandidates/fetchAndCacheAvatar/fetchCachedAvatar`，149-312；经后端 `market/avatar` 代理，TTL 24h/10min，上限 256）
  - bundle 判定：`isBundleSearchObject/canInstallBundleSearchObject` (314-321)
  - 搜索体系：`badges` 徽章表 (332-368)、`comparators` 排序器表 (574-599：default/recommend/download/created/updated)、`categories` 15 类 (601-616)、`kConfig` InjectionKey (628)
  - 过滤/排序：`getVisible`、`getSorted/getSortedPrepared/getSortedFiltered/getFiltered/getSilentFiltered` (630-730)、`parseSilentFilters/hasFilter/resolveCategory/validateWord/validate` (732-833，支持 is:/not:/impl:/locale:/using:/category:/email:/created|updated 比较与 within)、推荐评分（getRecommendScore 541-562：popularity/maintenance/freshness/trust/quality/exploration 加权 × 风险系数）、搜索相似度与索引缓存（getSearchIndex/getSimilarity*，376-472，WeakMap 缓存）
- **market/components/filter.vue (676 行)**：侧栏过滤器（sort 组 6-18、badge 组带计数 19-37、高级日期过滤 `<details>`（created/updated within/after/before 草稿-提交式输入，38-130）、category 组带计数 131-146）。script 149-470：activeSort 解析 (177-190)、dateFilters/relativeDateFilters 双向读写 words token（支持旧 `>` `<` 与新 `>=` `<=`，192-226)、badgeCounts/categoryCounts computed (233-258)、toggleSort/toggleCategory/toggleQuery (260-312)、日期规范化/校验/清空（314-459）。styles 472-676。
- **market/components/list.vue (375 行)**：虚拟滚动列表。script 39-320：batchSize（`limit:` 词，默认 24）、IntersectionObserver 触底加载 + ResizeObserver 测量列数/行高、`schedulePackageUpdate`（rAF 内 getVisible→getFiltered→getSortedPrepared，可 emit debug timings）、`updateVirtual` 手写窗口化虚拟滚动（overscan 3 行、spacer div）、`onQuery`（badge 点击回填搜索词）、settled 动画状态。列表尾部有 "market end" koishi 图标小彩蛋 (24-32)。
- **market/components/package.vue (686 行)**：市场卡片。script 76-343：homepage/badge（bundle 优先，107-120）、bundlePackage；**头像子系统**（94-341 的大头）：avatarViews computed（候选链+缓存查找）、失败降级游标 avatarCursor、render error→cacheAvatarFailure+换下一候选、render load→fetchAndCacheAvatar 后端缓存、requestIdleCallback 空闲水合 hydrateCachedAvatars；时间显示（timeAgo/updatedAgo，服务端时钟 `store.market.serverNow` 校准 274-300）、更新新鲜度心形颜色样式 updatedMetaStyle (302-325)、formatSize。emit `query` 供徽章/头像邮箱点击回填搜索。
- **market/components/search.vue (264 行)**：token 化搜索框（已提交词 chips + 草稿 input，120ms debounce/500ms maxWait；backspace 删词、escape 清草稿、点击词删除、clear 按钮、invalid 词划线）。defineExpose({focus}) 供 Ctrl+K。

**消费关系**：pages/market/market.vue 从 `../market` 导入 MarketFilter/MarketList/MarketSearch + getSilentFiltered/getVisible/kConfig/parseSilentFilters；list.vue 再内嵌 market/components/package.vue；state.ts 被 index.ts（restoreMarketLookups）、market.vue（loadMarketSnapshot/snapshot refs）、package.vue（getMarketObject）、dependencies.vue（loadMarketObjects）、extensions（loadMarketObjects/loadMarketServiceProviders）消费。

**P6 补全考据——market 模块的算法与数据细节**：

1. **市场推荐排序评分公式**（参考 client/market/utils.ts:129-270）：
   - 搜索相似度分档：包名全等 1 / `-`/`_` 分词命中 0.5 / 包名前缀 0.4 / 分词前缀 0.3 / 包名包含 0.25 / 分词包含 0.2 / 关键词包含 0.05 / 否则 0（任一词为 0 则整条 0）。
   - 搜索分 = rank × Σ相似度，rank = `rating ?? (1 - log2(days+1)/16)`。
   - 推荐公式 `100 × (0.30×popularity + 0.24×maintenance + 0.16×freshness + 0.12×trust + 0.10×quality + 0.08×exploration)`。
   - popularity = `sigmoid(log10(下载+1), 2.6, 1.15)`；maintenance = `exp(-更新天数/120)`；freshness：≤30d→1 / ≤90d→0.75 / ≤180d→0.45 / 其余 `exp(-days/720)`；trust：verified 0.55 + portable 0.15 + 有链接 0.10；quality：manifest 描述 0.22 + package 描述 0.18 + 分类非 other 0.14 + keywords≥3 0.12 + 有 maintainers 0.10 + license 0.08 + 非 bundle 0.08；exploration = `(1-sigmoid(log10(下载+1),2.2,1.25)) × maintenance × clamp((quality-0.35)/0.65)`。
   - 风险乘数：insecure 0.15 / deprecated 0.25 / preview 0.60；已安装再乘 0.18。
2. **头像候选链构造**（参考 client/market/avatar.ts:39-103）：gravatar 基址顺序：自定义（`GRAVATAR_MIRROR`，自动剥尾部 `/avatar`）→ cravatar.cn → www.cravatar.cn → s.gravatar.com → www.gravatar.com → gravatar.com；URL 一律 `{base}/avatar/{md5(email.trim().toLowerCase())}.png?d=404`；npm-avatar 代理 URL = `https://www.npmjs.com/npm-avatar/{base64url('https://s.gravatar.com/avatar/{hash}.png?size=100&default=404')}`；候选顺序 explicit（支持 data:）/ url（须图片扩展名正则）/ gravatar×N / npm-avatar，按 url+cacheKey 去重；data: URL 直接返回不走缓存。注意：参考用 `spark-md5` 算 gravatar md5，重构后 `@noble/hashes` v2 **不含 md5**，若需 md5 须另寻实现。
3. **用户合并规则**（参考 client/market/users.ts:5-26）：contributors 按 email/username/name 键去重合并且 maintainers 已在其中时**丢弃 maintainers**，否则用 maintainers（`name||username` 归一）；WeakMap 缓存。

# 4. extensions/ — Console 其他页面的扩展注入

入口 `extensions/index.ts (125 行)`：
- `patchConfigRemoveLabel` (20-54)：patch 官方 config.tree 菜单 `.remove` 的 label——bundle 组→"卸载 Bundle"、组→"移除分组"、叶子→"移除配置"（watch ctx.internal.menus，可还原）
- `patchConfigRemoveAction` (56-87)：替换 `ctx.internal.actions['config.tree.remove']`——保护节点禁用；bundle 组走 `requestBundleGroupUninstall`，否则 `requestConfigRemove`
- slots：`global`×2（ConfigRemove、BundleGroupUninstall 对话框）、`plugin-dependency`→Dependency（插件详情页依赖区，disabled 无 store.packages）、`plugin-details`→Version（order 1000）、`plugin-missing`→Missing、`plugin-select`→Select

各扩展（每个一个子目录，index.vue + 有逻辑加 index.ts）：
- **config-remove/（index.ts 26 行 + index.vue 62 行）**：配置树节点移除确认（`manager/remove` RPC + 跳转父路径）；`isProtectedConfigNode` 保护 console/config/server 三个核心插件
- **bundle-group-uninstall/（index.ts 9 行 + index.vue 128 行）**：把配置树里的 bundle 分组节点映射成 bundle 包名（resolveBundlePackageFromGroup / fetchBundleRecord 补拉），复用 dialogs/bundle-uninstall/index.vue（redirectToPlugins）
- **dependency/index.vue (52 行)**（plugin-dependency 槽）：插件详情页 peer 依赖/服务展示；未加载服务列出可用提供者（getMarketServiceProviders，watch→loadMarketServiceProviders）
- **dep-link/index.vue (22 行)**：依赖名链接（点击 `active = name` 打开安装面板），显示"点击加载/配置/添加"状态
- **missing/index.vue (46 行)**（plugin-missing 槽）：插件缺失提示——猜候选包名（@koishijs/plugin-* / koishi-plugin-*）查 getMarketObject，命中可快速安装，否则跳 `/market?keyword=`
- **select/index.vue (44 行)**（plugin-select 槽，覆盖 `plugin-select-base`）：给"添加插件"选择器加分类 tab（all/other + 15 categories），通过 `provide('plugin-select-filter')` 过滤；watch store.packages → loadMarketObjects
- **version/index.vue (232 行)**（plugin-details 槽）：插件详情页的链接导航（homepage/npm/repository/issues）+ 卸载按钮 + outdated/deprecated/external 提示；含卸载确认对话框与 bundle 卸载（复用 dialogs/bundle-uninstall/index.vue），bulkMode 暂存逻辑与 version/index.vue 内 requestUninstall/cancelPendingUninstall/uninstallDependency (128-201)

# 5. i18n 体系

- **i18n.ts (87 行)**：namespace = `marketNext`。静态 import 所有 yml（构建期打包，非运行时加载），组成 `{ 'zh-CN': {common, dependencies, marketPage, operations, dependencyCard, extensions, bundle, environment, market}, 'en-US': {...} }`。三个导出：`registerMarketNextI18n(ctx)`（拿 `ctx.$i18n.i18n.global` composer 并装 guard）、`useMarketNextI18n()`（组合式，t 自动加 `marketNext.` 前缀）、`translate(key)`（非组合式全局翻译，composer 缺失时回退返回 key）
- **i18n-runtime.ts (75 行)**：`ensureLocaleNamespace`（递归比对完整性后 mergeLocaleMessage）、`installLocaleNamespaceGuard`（monkey-patch `setLocaleMessage`，老版本 bundle 恢复 locale 快照时自动重新合并本插件 namespace；guard 注册表用全局 WeakMap 防多实例，注册键 `Symbol.for('koishi-plugin-market-next/i18n-namespace-guards')`——键名含旧包名，多实例共存判定依赖它）
- **locales/**（zh-CN 与 en-US 各 8 个文件）：common(72 行/9 顶级键)、dependencies(68/6)、dependency-card(145/12)、market-page(115/10)、operations(169/5)、bundle(95/11)、environment(45/36)、extensions(53/6)。合计约 750 行 ×2 语言，量级数百 key
- **market/locales/**（market 模块自带，注册在 `marketNext.market.*` 下）：en-US、zh-CN、zh-TW、ja-JP、de-DE、fr-FR、ru-RU 七语言，每份 ~53-61 行 / 7 个顶级键（type/badge/sort/advanced/category/time/search）。**注意只有 zh-CN 和 en-US 被 i18n.ts 静态引入，其余 5 种语言当前无人加载。**

# 6. 其他

- **pages/dependencies/use-local-package-upload.ts (168 行)**：本地 .tgz 分块上传状态机。`uploadFile`（`market/local-package-upload-start` → 循环 `...-chunk`（Binary.toBase64）→ `...-finish` 得 preview）、`installPackage`（`...-commit` 后调共享 `install()` 并带自定义文案）、`reset`（含 cancel）、generation 计数防竞态、onScopeDispose 自动 cancel。被 manual.vue 使用。
- **icons/（client/shared/icons，Koishi 全局图标注册）**：index.ts (17 行) 把 `activity:deps`、`activity:market`（活动栏图标）和 `refresh/rocket/bomb/market-next:upload` 注册进 `@koishijs/client` 的 icons 系统——供 ctx.page icon、菜单 icon（April fools 的 bomb）、k-icon name 使用
- **market/icons/（market 模块内部图标，MarketIcon 组件）**：index.ts (33 行) 合并 misc(16 个)/outline(17 个)/solid(17 个) 三张映射表，导出一个 `name` prop 的函数组件，匹配不到返回 null。misc 是杂项（asc/download/tag/verified…），outline/solid 是 15 分类 × 两种线宽 + all。
- **styles/**：scrollbars.scss (73 行，全局细滚动条) 和 version-select.scss (105 行，`.market-version-select` / `.market-version-popper` 的 el-select 主题覆盖)——两者由 index.ts 顶层 import，全局生效。
- **koishi-eye-splash.vue (229 行) + koishi-eye-splash.json**：彩蛋动画组件。动态 import `lottie-web`（light 版）+ JSON 数据；播放 segments [25,880] 循环、速度 1.12；`enterFrame` 里在特定帧点亮 SVG 覆盖节点（nodePoints 6 个坐标）、帧 287 emit `ready`、帧 543 emit `complete`；`document.hidden` 时暂停；加载失败时直接 emit ready+complete 保证文案可用。**用途/触发**：仅被 market-secret-archive.vue 使用——在 /market 搜索 "恋恋…世界第一" 触发秘密档案彩蛋时作为视觉动画，`ready`/`complete` 事件驱动档案文案的逐段 reveal。

# 7. 组件间共享逻辑

**client/shared/plugin-config.ts (429 行) 导出**（几乎全部组件在用）：
- `active` (18)——当前安装面板目标包名（dialogs/install/index.vue、dep-link.vue、missing.vue、market.vue 写入）
- 类型：FrontendMode/LayoutMode/MarketNextConfigPatch/MarketSilent*Rule×5/UpdateIgnoreOptions/UpdatePolicy/MarketNextDataStore
- 数据存取：`getPendingOverrides`(109)、`getCollapsedGroups`(115)、`getBundleRecords`(294)、`getWritableBundleRecords`(298)、`getMarketNextConfig`(251，遍历 config.plugins 递归找本插件节点，兼容禁用 `~` 前缀)、`getMarketNextPolicy`(255)/`getWritableMarketNextPolicy`(269)、`patchMarketNextConfig`(304，send `market/update-config`)、`patchMarketNextData`(315，send `market/update-data`)
- 模式：`normalizeFrontendMode`(121)、`getFrontendMode`(125)、`getDepsLayout`(131)、`getBulkMode`(278)、`getRemoveConfig`(286)
- 静默规则：`getMarketSilentFilters`(148)、`getMarketSilentRules`(162)、`rulesToSilentFilters`(218)、`ruleToSilentFilter`(225)
- **静默规则→过滤词映射细节（P6 补全）**：三代配置共存优先级 `marketSilentRules`（新版 table）> 四类结构化 legacy 规则（marketSilentStatusRules/DateRules/RecentRules/CustomRules）> `marketSilentFilters` 字符串；日期须 `YYYY-MM-DD`、天数须正整数才生效；映射语法 `is:preview`、`created:<2024-01-01`、`created:within:30`。
- 更新忽略：`createUpdateIgnoreRule`(329)、`getLatestVersion`(343)、`getIgnoredUpdateVersion`(348)、`getUpdateIgnoreText`(355)、`isUpdateIgnored`(364)、`hasUpdate`(368)、`isUpdateCheckDisabled`(377)

使用方：index.ts、components/{package,bundle-install,bundle-uninstall,confirm,dependencies,environment-versions,install-history,install-progress,install,manual,market}.vue、extensions/{index,dep-link,missing,version,bundle-group-uninstall}、market/components/*（经 market/index.ts re-export）。

**client/shared/operations.ts (531 行) 导出**（安装域共享层）：
- `getConfigWriter`(25)、`analyzeVersions`(40，peer 依赖兼容性分析)、`manualDeps`(68，手动查询的 registry 缓存)、`addManual`(111，send `market/package`)
- registry 状态：`getRegistryStatus`(74)、`getRegistryStatusText`(78)
- 对话框开关 refs：`showManual/showConfirm/showInstallHistory/showEnvironmentVersions`(118-121)、`expandedDependency`(122)、`activeBundle`(123，bundle-install 面板开关)、`pendingBundleUninstalls`(128)
- bundle 记录：`createBundleRecordFromManifest`(138)、`createLocalBundleRecord`(156)、`resolveBundlePackageFromGroup`(166)、`resolveBundleRecordFromGroup`(181)、`isBundleGroupPath`(191)、`getBundleMemberConfigState`(196，查 configWriter 分组内/外配置)、`fetchBundleRecord`(216)
- 安装进度全局状态：`MARKET_NEXT_PACKAGE`(249)、`installProgressState`(251，reactive：visible/status/logs/title/selfUpdate/environmentRestore/fallback*)、`receive('market/install-log')`(264)
- 安装执行：`pushInstallLog`(281)、`resetInstallFallbackState`(285)、`prepareInstallFallbackRetry`(292，send `market/install-fallback-candidate`)、`install()`(347-432，核心：send `market/install` + socket 断连竞速 + 8s 等待文案 + fallback 重试 + callback)、`applyEnvironmentSnapshot`(434-498，send `market/environment-snapshot-apply`)
- 配置保障：`ensureInstalledConfig`(519，send `market/ensure-config` + 轮询等待 + configWriter.ensure 兜底)、`ensureInstalledConfigs`(529)

使用方：index.ts、全部 pages/{market,dependencies}/*.vue 与 dialogs/*.vue（除 progress/koishi-eye-splash/market-secret-archive/local-package-upload）、pages/dependencies/use-local-package-upload.ts、extensions/{index,version,bundle-group-uninstall}。

**值得注意的耦合点（重构提示）**：`installProgressState` 是跨组件可变单例（utils.ts 定义、dialogs/bundle-install/index.vue 直接写、dialogs/install-progress/index.vue 读）；`active`/`activeBundle`/`showConfirm` 等 6 个 ref 是"以模块级 ref 充当全局对话框 store"；`store.market` 在 market/state.ts 与官方 Console 间双向同步（publishSnapshot 写入、markRaw 防代理）；i18n guard 依赖 monkey-patch 以兼容新旧 bundle 共存。
