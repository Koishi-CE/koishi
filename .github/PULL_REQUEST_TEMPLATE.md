# PR 说明

- **本仓一切改动都走 PR，禁止直推 `main`**：PR 由维护者合并，AI / agent 产出的 PR 不自审自并。规矩见根 `AGENTS.md` 的 git 提交流程节与 `docs/guides/development.md` 的 PR 工作流节。
- 标题与正文一律简体中文，标题用提交信息风格（`fix(core): ……`）。
- 空章节写「无」，不要删标题——便于对账。

## 1. 改了什么

<!-- 一句话结论 + 分点列改动；涉及文档 / 配置 / 构建链时点名文件。 -->

## 2. 验证证据

<!-- 实跑结论，不写「应该没问题」：门禁与测试的实际输出摘要。 -->

- [ ] `bun run check` 全绿（九段构成见 `docs/guides/development.md`）
- [ ] `bun run test` 全绿（有测试改动时写清新增 / 修改的用例数与文件）
- [ ] `bun run build` 通过（改了源码 / 构建链时必跑）
- [ ] `bun run fallow` 无问题（动了依赖 / 导出面时必跑）
- [ ] 改了 webui 插件或 `.vue` 时重建过对应前端产物

## 3. changeset

<!-- 面向发布的包有行为变化 → 随 PR 写 .changeset/ 条目；纯内部 / 文档 / 私有包改动 → 「无」。shim 四包与私有包一律不写。 -->

- 无

## 4. 影响面与风险

<!-- 兼容性、发布面、需要人工复核的点、回滚方式；无则写「无」。 -->

## 5. 关联

<!-- 相关 issue / 上游 commit 或 PR（port 须给上游 ref，见 docs/process/upstream.md）；无则写「无」。 -->
