# client/ 目录结构

控制台前端（Vue 3）。入口 `index.ts` 被 `src/node/index.ts`（dev：宿主 vite 实时编译）和
`scripts/build-client.ts`（prod：`vite.build` → `dist/index.js` + `dist/style.css`）引用，位置不可动。

```
client/
├── index.ts          # 插件入口：注册 i18n、恢复市场快照、装 app/pages + app/actions
├── app/              # 控制台接线层
│   ├── pages.ts      #   页面（/market、/dependencies）与 global/status 插槽注册
│   ├── actions.ts    #   动作、菜单、快捷键、季节彩蛋
│   └── registry-state.ts  # registry 状态仓 + 超时 sweep + receive() 监听
├── pages/            # 路由页面 + 页面私有组件（每页一个子目录）
│   ├── market/       #   市场页壳 + 彩蛋链（market-secret-archive → koishi-eye-splash+json）
│   └── dependencies/ #   依赖管理页 + package/manual/local-package-upload + 上传 composable
├── dialogs/          # 全局插槽对话框与状态浮层（每对话框一个子目录，
│                     #   index.vue + index.scss）
│                     #   install/ bundle-install/ bundle-uninstall/ confirm/
│                     #   install-progress/ install-history/ environment-versions/ progress/
├── market/           # 市场引擎模块：state/utils/avatar/users + components（filter/list/
│                     #   search/package）+ icons（MarketIcon 注册表）+ locales（7 语言）
├── extensions/       # 宿主控制台插槽注入（config 树、插件详情/依赖/选择页扩展；
│                     #   每扩展一个子目录：index.vue + 有逻辑加 index.ts + 有样式加 index.scss）
└── shared/           # 跨模块共享层
    ├── i18n.ts       #   marketNext 命名空间注册（locales/ 8 namespace × 2 语言）
    ├── plugin-config.ts  # 插件配置读写、更新忽略策略、静默过滤规则（原根 utils.ts）
    ├── operations.ts #   安装编排、对话框可见状态、依赖分析、bundle 记录（原 components/utils.ts）
    ├── page-boundary.ts  # 页面错误边界
    ├── icons/        #   Koishi 全局图标注册（activity:market 等 6 枚，与 market/icons 两套体系）
    ├── locales/      #   zh-CN / en-US 文案
    └── styles/       #   全局样式（scrollbars、version-select）
```

## 约定

- **组件样式出仓**：`.vue` 不内联 `<style>`，同目录放同名 `.scss`，经
  `<style lang="scss" [scoped] src="./xxx.scss">` 引入（`package.vue` 例外地有第二个
  `package-scoped.scss`）。
- **相对路径、无别名**：宿主 console 的 vite dev server 直接编译本目录源码，不读取本插件
  的 vite 配置，因此不能使用 `@/` 之类的路径别名，跨目录引用一律写相对路径。
- **服务端共享代码**：`../src/shared/*`（bundle、bundle-idents、dependency-source、update）
  是前后端共用的纯逻辑模块，深度敏感，移动文件时注意相对层级。
- **两套图标**：`shared/icons/` 把图标注册进 Koishi 全局 icons 系统（按名字字符串引用）；
  `market/icons/` 是本插件自己的 `MarketIcon` 组件注册表（按组件传入）。
- **对话框状态**：全局对话框的开关 ref（showConfirm/showInstallHistory 等）集中在
  `shared/operations.ts`，由 `app/pages.ts` 注册为 global 插槽。
