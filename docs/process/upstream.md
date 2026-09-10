# Upstream Tracking

This repository is a community redistribution: it was bootstrapped by merging two upstream repositories as plain file copies (**no git history was preserved**) and restructuring them, and later redistributes a few plugins from other upstream repos. Porting upstream changes therefore has to be done manually, by diffing against an upstream checkout at the baseline version.

**On this page**: [Baselines](#baselines) · [Restructure map](#restructure-map) · [Upstreams](#upstreams) · [Syncing upstream changes](#syncing-upstream-changes) · [Routine inspection](#routine-inspection) · [Inspection log](#inspection-log). Related: [docs index](../README.md) · [../guides/development.md](../guides/development.md) · [../reference/architecture.md](../reference/architecture.md).

## Baselines

No git history is preserved, so baselines are stated as upstream release lines rather than exact commits:

- koishi — the `koishi@4.18.11` release line (core / cli; `@koishijs/loader` 4.6.x, `@koishijs/utils` 7.3.x form — the 7.3 releases are byte-identical to the 7.2.1 sources plus the `merge` prototype-pollution fix, which is included here, `@koishijs/i18n-utils` 1.0.x)
- webui — the `@koishijs/plugin-console@5.30.11` release line (the bootstrap snapshot is effectively webui `main` at 2026-06-27, which includes post-5.30.11 plugin releases such as admin 2.0.0 and market v2.11.11); `plugins/market` is aligned to upstream market **v2.11.11**
- assets — the `@koishijs/assets@1.1.2` line (`packages/core` and `packages/local`)
- others — `plugins/common/rate-limit` from [koishijs/common](https://github.com/koishijs/common), `plugins/common/cron` from [koishijs/koishi-plugin-cron](https://github.com/koishijs/koishi-plugin-cron) (rewritten on `Bun.cron`, not a direct port), `plugins/infra/memory` (a two-source merge, see the map below), `plugins/infra/server-temp` from [cordiverse/server](https://github.com/cordiverse/server) (upstream deleted `packages/temp` on 2025-03-19 — the line is dead upstream and maintained independently here), `plugins/infra/sqlite` (a three-source merge, see the map below), `plugins/webui/{dataview,theme-vanilla}` from their standalone repos; see `NOTICE` for the full provenance table

## Restructure map

| This repo | Upstream |
| --- | --- |
| `packages/node/cli` | koishi `packages/koishi` (renamed to `@koishi-ce/koishi`) |
| `packages/node/{core,loader,utils,i18n-utils}` | koishi `packages/*` (unchanged names) |
| `packages/node/console` | webui `packages/console` |
| `packages/node/registry` | webui `packages/registry` |
| `packages/node/assets` | [koishijs/assets](https://github.com/koishijs/assets) `packages/core` |
| `packages/web/{client,components}` | webui `packages/*` |
| `plugins/infra/{http,server,hmr,mock}` | koishi `plugins/*` |
| `plugins/infra/proxy`（上游目录为 `proxy-agent`，本地改名） | koishi `plugins/proxy-agent` |
| `plugins/infra/memory`（两源合并：koishi 包装层 + minato 驱动实现） | [cordiverse/database](https://github.com/cordiverse/database)（原 `cordiverse/minato`，已改名）`packages/memory`（`@minatojs/driver-memory` 3.7.0）· [koishijs/upstream](https://github.com/koishijs/upstream) `database/memory`（包装层 3.7.0；上游 `repository.directory` 仍写旧路径 `plugins/database/*`，实存路径在仓库根 `database/*`） |
| `plugins/infra/sqlite`（三源合并：cordis 3 线 driver + cordis 3 线 koishi 包装层 + cordis 4 线 `node:sqlite` 引擎层） | [cordiverse/database](https://github.com/cordiverse/database) `packages/sqlite`（3 线 `@minatojs/driver-sqlite` 4.7.0；master 现为 4 线 `@cordisjs/plugin-database-sqlite` 5.1.1）· [koishijs/upstream](https://github.com/koishijs/upstream) `database/sqlite`（包装层） |
| `plugins/infra/server-temp` | [cordiverse/server](https://github.com/cordiverse/server) `packages/temp` |
| `plugins/common/{bind,broadcast,callme,echo,help,inspect}` | koishi `plugins/common/*` |
| `plugins/common/assets-local` | [koishijs/assets](https://github.com/koishijs/assets) `packages/local` |
| `plugins/common/rate-limit` | [koishijs/common](https://github.com/koishijs/common) `packages/rate-limit` |
| `plugins/common/cron`（以 `Bun.cron` 原生重写，非直接移植；溢出缺陷背景见 [koishijs/koishi-plugin-cron#8](https://github.com/koishijs/koishi-plugin-cron/issues/8)） | [koishijs/koishi-plugin-cron](https://github.com/koishijs/koishi-plugin-cron) · [cron-fix](https://github.com/koishi-shangxue-plugins/service-more/tree/main/packages/cron-fix)（修复参考） |
| the 15 `plugins/webui/*` (`actions` … `status`) and `market` | webui `plugins/*` |
| `plugins/webui/dataview` | [koishijs/koishi-plugin-dataview](https://github.com/koishijs/koishi-plugin-dataview) |
| `plugins/webui/theme-vanilla` | [koishijs/koishi-plugin-theme-vanilla](https://github.com/koishijs/koishi-plugin-theme-vanilla)（原 `koishijs/theme-vanilla`，已改名） |
| `tsconfig.client.json` | webui `tsconfig.client.json` |
| `LICENSES/AGPL-3.0.txt` | webui `LICENSE` |
| `packages/shim/*`, `apps/*`, `tooling/*`, root configs | original work of this repository |

Local regrouping (upstream packages are flat `packages/*` / `plugins/*`): `packages/node` and `packages/web` split by runtime, `plugins/{common,infra,webui}` split by origin/role. Upstream package names map to the `@koishi-ce` scope (`@koishijs/X` → `@koishi-ce/X`, `koishi` → `@koishi-ce/koishi`).

Naming rules:

- Code inside this monorepo imports `@koishi-ce/*` exclusively. The only external upstream import is `@koishijs/plugin-server-proxy` (type-only, console). The test memory driver used to be `@koishijs/plugin-database-memory` and is now CE-native (`@koishi-ce/plugin-database-memory`, `plugins/infra/memory`).
- `peerDependencies` of CE packages target CE names (`@koishi-ce/* ^1.0.0`) so that Bun never auto-installs the official npm packages. Downstream projects occupy the upstream names via npm aliases to the frozen shims (`@koishi-ce/koishi-shim`, `@koishi-ce/console-shim`) — see `packages/shim/README.md` and [../reference/architecture.md](../reference/architecture.md).
- Dependencies on packages outside this monorepo keep their upstream names.

## Upstreams

- koishi — <https://github.com/koishijs/koishi> (MIT)
- webui — <https://github.com/koishijs/webui> (AGPL-3.0, some packages MIT)
- assets — <https://github.com/koishijs/assets> (MIT)
- common — <https://github.com/koishijs/common> (MIT)
- koishi-plugin-cron — <https://github.com/koishijs/koishi-plugin-cron> (MIT, reference only)
- cordiverse/server — <https://github.com/cordiverse/server> (MIT; `packages/temp` deleted upstream 2025-03, line dead)
- cordiverse/database — <https://github.com/cordiverse/database> (MIT; renamed from `cordiverse/minato`, hosts both the 3-line drivers and the cordis-4 engine layer)
- koishijs/upstream — <https://github.com/koishijs/upstream> (MIT, thin re-export wrappers for database plugins)
- koishi-plugin-dataview — <https://github.com/koishijs/koishi-plugin-dataview> (AGPL-3.0)
- koishi-plugin-theme-vanilla — <https://github.com/koishijs/koishi-plugin-theme-vanilla> (AGPL-3.0; renamed from `koishijs/theme-vanilla`)

## Syncing upstream changes

1. Clone or fetch the upstream repo at the release line you track — or just run `bun tooling/upstream-audit.ts`, which refreshes a shallow-clone cache under `../upstream-cache` (outside this repository; override with `KOISHI_CE_UPSTREAM_CACHE`) and prints a per-directory diff draft.
2. Diff the relevant upstream `packages/*` / `plugins/*` directory against the mapped directory here (see the table above). Suppress whitespace noise with `git diff --no-index -w` (upstream indents with spaces, this repo with tabs).
3. Port changes by hand. Upstream sources use extension-less bundler-style relative imports; this repo type-checks under NodeNext, so **relative imports must carry the `.ts` extension** when ported. Every port must be traceable to an upstream commit / PR / issue — leave a `// upstream: <repo>#<ref>` comment at the ported site (no git history exists here, so the comment is the provenance record).
4. Verify with `bun run build` + `bun test` (and `bun run check` when in doubt). Front-end changes additionally need `bun packages/web/client/src/bin.ts build <plugin-dir>`.

## Routine inspection

Porting is demand-driven; inspection makes it proactive. The loop:

1. **Run the audit script** — `bun tooling/upstream-audit.ts` (add `--only <name>` for one upstream, `--no-refresh` offline). It clones/pulls all upstreams into the cache dir, then prints a markdown draft: per-mapping files that exist on only one side, and common files ranked by `-w` churn.
2. **Check upstream movement** — the draft lists each repo HEAD. For any upstream that moved, list commits since our baseline (GitHub `compare` view) and read the ones touching mapped directories.
3. **Triage every finding** into exactly one class:
   - **A — security fix**: port first, verify against local protection (this repo may already be immune via a stronger local fix).
   - **B — functional bug fix**: port candidate; check reachability under this repo's stack (Bun, cordis 3 freeze, restructures).
   - **C — new feature**: port only if it fits this repo's direction; features entangled with cordis 4 / yarn-yakumo build stay out.
   - **D — refactor / chore**: usually skip; note exceptions (dead-code removal, doc fixes).
   - **E — conflicts with local intent**: never port. Includes: anything requiring cordis 4 / minato 4 (freeze, see [../decisions/upgrade-plan.md](../decisions/upgrade-plan.md) Phase 5), vendored packages (`plugins/infra/{http,proxy,server}`), frozen shims, the market client fork views, and Bun-native rewrites (hmr, cron, status agent detection).
   - **F — already present**: record and move on (upstream fixes often arrived here first via independent fixes).
4. **Port** per the rules in [Syncing upstream changes](#syncing-upstream-changes): minimal diff, `.ts` extensions, upstream-ref comment, changeset when published behavior changes, full gate (`bun run check` + `bun run build` + `bun test`) before commit. Ports and mechanism/doc changes go in separate commits.
5. **Record** the round in [Inspection log](#inspection-log) below — positions, classifications, ports with provenance, and any change to the Phase 5 restart conditions (also mirror into [../roadmap.md §1.1](../roadmap.md)).

Cadence: before each release train at minimum; ad hoc whenever an upstream CVE lands. Noise filters that must never be reported as findings: import renames (`@koishijs/*` → `@koishi-ce/*`), `.ts` suffixes, indentation, package.json metadata, i18n dictionary strengthening, and the intentional divergences listed in class E.

## Inspection log

### 2026-09-10 — first full round

Method: npm `dist-tags` for every upstream package, GitHub `compare` for post-baseline commits, shallow-clone cache + per-directory diffs (six parallel reviews, one per upstream group).

**Upstream positions.**

| Upstream | HEAD | Drift vs baseline |
| --- | --- | --- |
| koishi | `5525cfd` 2026-08-29 | 4.18.11 + 1 test-only commit ([#1549](https://github.com/koishijs/koishi/pull/1549)) — ported this round |
| webui | `ec7b484` 2026-06-27 | none (equals the bootstrap snapshot) |
| assets | `8bd7d94` 2024-05-30 | none (1.1.2 release commit is HEAD) |
| common | `667e7d7` 2024-12-22 | none touching `packages/rate-limit` (the shutdown fix is another package) |
| koishi-plugin-cron | `99dbea1` 2023-12-01 | dormant; overflow issue [koishi-plugin-cron#8](https://github.com/koishijs/koishi-plugin-cron/issues/8) still open upstream |
| cordiverse/server | `dc7feec` 2026-06-12 | `packages/temp` deleted upstream 2025-03-19; its sources unchanged since 1.5.0 — line dead, maintained independently here |
| koishi-plugin-dataview | `9c4efec` 2025-02-28 | none (2.7.8 release commit is HEAD) |
| koishi-plugin-theme-vanilla | `9f8ffdd` 2024-10-28 | unreleased sass-2.0 migration — already present here |
| cordiverse/database | `4489157` 2026-07-15 | 3-line frozen (memory 3.7.0 / sqlite 4.7.0 are the last 3-line releases); master is the cordis-4 line |
| koishijs/upstream | `705f3f4` 2026-08-17 | wrappers unchanged since 3.7.0/4.7.0 |

**Security review** — upstream CVE-class fixes verified: webui[#362](https://github.com/koishijs/webui/pull/362) arbitrary file read (local protection is a superset: per-entry 403 plus strict `root + sep` prefix, upstream used a prefix-bypassable `startsWith(root)`); admin internal-API authority fix (`e8d76cf8`, present); console route regex hardening (`855422a0`, present).

**Ports this round** (2, both B):

1. [koishijs/koishi#1549](https://github.com/koishijs/koishi/pull/1549) (`5525cfd`) — middleware tests stop the app in teardown. Test-only.
2. [cordiverse/database#132](https://github.com/cordiverse/database/pull/132) (`96d0590`, adapted) — sqlite `dropAll`/`stats` enumerate physical tables from `sqlite_master` instead of the shared model registry (multi-driver registries contain tables other drivers own). Upstream implements this with a minato-4 core-maintained per-driver table set; the physical enumeration is the 3-line equivalent. Changeset: patch.

**Deferred / observed (not ported).**

- minato core `transact` retry defect ([cordiverse/database@69f4c4d](https://github.com/cordiverse/database/commit/69f4c4d), upstream #138): lives inside frozen npm `minato@3.7.0`; driver-side protection already exists here. Fixing core means vendoring minato — separate project if ever needed.
- `SharedCache` in core middleware: upstream deleted the class; here it is still publicly exported with zero runtime consumers. Optional cleanup, but it is public API — needs a deprecation decision first.
- Class E (cordis 4 line): uuid field chain, `setOne`, `$startsWith` GLOB operator, batched field loading, server-temp peer bumps — all require minato/cordis 4.
- webui `packages/online` (Koishi Online showcase site) intentionally out of scope.
- CE-ahead fixes that could be offered upstream (optional, D): inspect null-element guard, help suggest guard, hmr win32 `isInNodeModules` fix, loader issues #998/#1286/#1328/#1519/#1465, i18n-utils #1464 fallback order.

**Phase 5 restart conditions: unchanged.** `@satorijs/core@4.6.0` still depends on `cordis ^3.18.1`; cordis latest is `4.0.0-rc.10` (RC, not stable); no upstream koishi migration started. Mirrored into [../roadmap.md §1.1](../roadmap.md).

**Structural notes.** Upstream repo renames: `koishijs/theme-vanilla` → `koishijs/koishi-plugin-theme-vanilla`, `cordiverse/minato` → `cordiverse/database` (links in this file and `NOTICE` updated this round). `koishijs/upstream` wrapper sources live at repo-root `database/*` while their `repository.directory` still claims `plugins/database/*` (upstream metadata bug, harmless).
