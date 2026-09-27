# @koishi-ce/console-builder

## 1.0.4

### Patch Changes

- 4dac9a8: 图标编译钉死单根产物，消除构建环境 NODE_ENV 漂移引发的透传断裂：
  
  - `FileSystemIconLoader` 增加 transform 回调，在 loader 层剥除 svg 根元素之前的注释（许可头、版权头等）。unplugin-icons 的 vue3 编译器调用 `compileTemplate` 时未透传 comments 选项，注释去留随构建进程的 NODE_ENV 漂移：development 环境下注释保留进产物，图标组件被编译成「注释 + svg」的多根 fragment；Vue 运行时对该 fragment 的 attribute 透传修复（getChildRoot）仅在 dev 运行时生效，prod 运行时外部 class 落不到 svg 上，侧栏图标回落 `.k-icon { height: 1em }` 的 1em 尺寸。剥除后产物恒为单根，与编译模式无关；
  - 新增 `stripLeadingSvgComments` 导出与四用例单测（许可头剥离、无注释原样、内部注释保留、连续注释段）。

## 1.0.3

### Patch Changes

- 4e3e49b: 构建管线的静默失败可观测化改造：
  
  - 工作区别名计算抽出独立模块（新增 `collectWorkspaceAliases` 导出，repoRoot 参数化可测试），消除两处静默吞错：仓库根清单损坏打印 error 后降级空表（下游安装形态无清单仍静默空表）、单个工作区包清单损坏打印 warn 后跳过；
  - `build()` 返回布尔值标示是否执行了构建，`koishi-console build <目录>` 对无 client/ 的目录显式报错 exit 1，不再 exit 0 静默假成；
  - 产物落盘循环对缺 source 的 asset 与缺 code 的 chunk 打印 warn，不再静默丢弃。
- Updated dependencies [74774de]
  - @koishi-ce/client@1.4.2
  - @koishi-ce/console-app@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [9a6ea29]
  - @koishi-ce/components@1.1.0
  - @koishi-ce/console-app@1.0.2
  - @koishi-ce/client@1.4.1

## 1.0.1

### Patch Changes

- Updated dependencies [f644c05]
- Updated dependencies [549520e]
  - @koishi-ce/client@1.4.0
  - @koishi-ce/console-app@1.0.1
