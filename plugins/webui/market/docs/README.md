# 文档索引（现状）

> 本目录是 `koishi-plugin-marketn-refactored` 的文档集，2026-08-23 整理后扁平化为「有效文档 + 契约基线」两类。
> 已完成阶段的阶段性文档（P3/P4 设计、handover 交接、移植指南、样式出仓计划）已删除——历史信息保留在 git 提交记录中。

## 当前状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 基线：工具链 / tsdown / vite / vitest / lint + check-size | ✅ |
| P1 | shared 平移：bundle / dependency-source / provider / types / update | ✅ |
| P2 | core 建设：utils → racing → registry → market → deps → install → upload → environment | ✅ |
| P3 | node 适配层：contracts / installer / market / providers / listeners / commands / avatar / bundle | ✅ |
| P4 | client 移植拆分：feature-first 重组 + 样式出仓 + 门禁全绿 | ✅ |
| P5 | 宿主联调：构建 lib+dist → 宿主 koishi.yml → dev 冒烟 → prod 复验 | ✅（已归档至 archive/） |
| P6 | 收尾：契约核对 → 删旧码 → README 定稿 → 最终 commit | ✅（已归档至 archive/） |
| 重构 | 复杂度治理 + 大文件拆分（B+C 特化） | ⏳ 待执行 |

## 有效文档链（按阅读顺序）

| 文档 | 用途 |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | **开发依据**：环境、门禁命令、编码约定、已知坑、fallow 用法 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层架构、依赖方向规则、契约冻结清单 |
| [CORE-MODULES.md](CORE-MODULES.md) | `src/shared` + `src/core` 模块职责、关键导出、构造 deps 签名 |
| [复杂度与大文件重构计划书.md](复杂度与大文件重构计划书.md) | **当前待执行计划**：17 个大文件拆分 + fallow 复杂度治理（B+C 特化） |
| [archive/](archive/) | 已完成阶段的归档计划书（P5-P6 联调验收、覆盖率攻坚、市场页渲染性能优化、fallow 清理） |
| [reference/前后端调用契约.md](reference/前后端调用契约.md) | **验收基线**：对外契约面全量清单（DataService / RPC / 广播 / HTTP / 命令） |
| [reference/构建与宿主接线.md](reference/构建与宿主接线.md) | 旧代码构建/加载链路考据（P5 联调的操作依据） |
| [reference/client端全量结构.md](reference/client端全量结构.md) | 旧 client 逐文件职责底册（P6 删旧码后的备份参照） |

> **关于 docs/ 的纪律**：除上表外，`docs/` 下不应出现其他文档。新文档仅在确有长期维护价值时创建（当前待执行计划书即为有效文档）；阶段性设计/交接记录直接写进提交信息，不再单独立档。

## 架构摘要（详见 ARCHITECTURE.md 与代码）

```
宿主 Koishi 应用 ──► src/node/（适配层，组装 core）──► src/core/（领域层，禁 koishi）──► src/shared/（共享语言层）
                        │  console 通道 / RPC / 广播
                        └──► client/（Vue 3 Console 前端，feature-first）
```

- **依赖方向不可逆**：`client → shared`、`node → core → shared`。
- **core 禁 koishi 运行时**：仅允许 `import type { Dict }` 与 `@koishijs/registry`，I/O 全部构造注入 `deps` 对象（`scripts/check-size.ts` 强制）。
- **契约冻结**（重构前后逐项一致，P6 核对）：DataService ×5、RPC ×23（口径以契约文档为准）、广播 ×5、HTTP ×1、命令 ×4、磁盘路径。完整清单见 [reference/前后端调用契约.md](reference/前后端调用契约.md)。
- **构建产物**：tsdown → `lib/node` + `lib/shared`（`lib/node/index.cjs`）；vite 8 → `dist/`（CSS 固定 `style.css`）。

## 旧代码位置

- **`参考/` 与 `原版参考/`**：重构过程参照与原版快照，**可以放心阅读、对照逻辑**，但**只读勿改**；P6 收尾阶段删除后，`reference/` 考据文档是唯一参照。
