# @koishi-ce/console-builder

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
