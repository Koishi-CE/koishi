---
"@koishi-ce/console-builder": patch
---

图标编译钉死单根产物，消除构建环境 NODE_ENV 漂移引发的透传断裂：

- `FileSystemIconLoader` 增加 transform 回调，在 loader 层剥除 svg 根元素之前的注释（许可头、版权头等）。unplugin-icons 的 vue3 编译器调用 `compileTemplate` 时未透传 comments 选项，注释去留随构建进程的 NODE_ENV 漂移：development 环境下注释保留进产物，图标组件被编译成「注释 + svg」的多根 fragment；Vue 运行时对该 fragment 的 attribute 透传修复（getChildRoot）仅在 dev 运行时生效，prod 运行时外部 class 落不到 svg 上，侧栏图标回落 `.k-icon { height: 1em }` 的 1em 尺寸。剥除后产物恒为单根，与编译模式无关；
- 新增 `stripLeadingSvgComments` 导出与四用例单测（许可头剥离、无注释原样、内部注释保留、连续注释段）。
