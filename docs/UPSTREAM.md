# Upstream Tracking

This repository is a community redistribution: it was bootstrapped by merging two upstream repositories as plain file copies (**no git history was preserved**) and restructuring them, and later redistributes a few plugins from other upstream repos. Porting upstream changes therefore has to be done manually, by diffing against an upstream checkout at the baseline version.

## Baselines

No git history is preserved, so baselines are stated as upstream release lines rather than exact commits:

- koishi — the `koishi@4.18.11` release line (core / cli; `@koishijs/loader` 4.6.x, `@koishijs/utils` 7.2.x, `@koishijs/i18n-utils` 1.0.x)
- webui — the `@koishijs/plugin-console@5.30.11` release line; `plugins/market` is aligned to upstream market **v2.11.11**
- assets — the `@koishijs/assets@1.1.2` line (`packages/core` and `packages/local`)
- others — `plugins/common/rate-limit` from [koishijs/common](https://github.com/koishijs/common), `plugins/infra/server-temp` from [cordiverse/server](https://github.com/cordiverse/server), `plugins/webui/{dataview,theme-vanilla}` from their standalone repos; see `NOTICE` for the full provenance table

## Restructure map

| This repo | Upstream |
| --- | --- |
| `packages/node/cli` | koishi `packages/koishi` (renamed to `@koishi-ce/koishi`) |
| `packages/node/{core,loader,utils,i18n-utils}` | koishi `packages/*` (unchanged names) |
| `packages/node/console` | webui `packages/console` |
| `packages/node/registry` | webui `packages/registry` |
| `packages/node/assets` | [koishijs/assets](https://github.com/koishijs/assets) `packages/core` |
| `packages/web/{client,components}` | webui `packages/*` |
| `plugins/infra/{http,server,hmr,mock,proxy-agent}` | koishi `plugins/*` |
| `plugins/infra/server-temp` | [cordiverse/server](https://github.com/cordiverse/server) `packages/temp` |
| `plugins/common/{bind,broadcast,callme,echo,help,inspect}` | koishi `plugins/common/*` |
| `plugins/common/assets-local` | [koishijs/assets](https://github.com/koishijs/assets) `packages/local` |
| `plugins/common/rate-limit` | [koishijs/common](https://github.com/koishijs/common) `packages/rate-limit` |
| the 15 `plugins/webui/*` (`actions` … `status`) and `market` | webui `plugins/*` |
| `plugins/webui/dataview` | [koishijs/koishi-plugin-dataview](https://github.com/koishijs/koishi-plugin-dataview) |
| `plugins/webui/theme-vanilla` | [koishijs/theme-vanilla](https://github.com/koishijs/theme-vanilla) |
| `tsconfig.client.json` | webui `tsconfig.client.json` |
| `LICENSES/AGPL-3.0.txt` | webui `LICENSE` |
| `packages/shim/*`, `apps/*`, `tooling/*`, root configs | original work of this repository |

Local regrouping (upstream packages are flat `packages/*` / `plugins/*`): `packages/node` and `packages/web` split by runtime, `plugins/{common,infra,webui}` split by origin/role. Upstream package names map to the `@koishi-ce` scope (`@koishijs/X` → `@koishi-ce/X`, `koishi` → `@koishi-ce/koishi`).

Naming rules:

- Code inside this monorepo imports `@koishi-ce/*` exclusively. The only external upstream imports are `@koishijs/plugin-database-memory` (tests) and `@koishijs/plugin-server-proxy` (type-only, console).
- `peerDependencies` of CE packages target CE names (`@koishi-ce/* ^1.0.0`) so that Bun never auto-installs the official npm packages. Downstream projects occupy the upstream names via npm aliases to the frozen shims (`@koishi-ce/koishi-shim`, `@koishi-ce/console-shim`) — see `packages/shim/README.md` and [ARCHITECTURE.md](./ARCHITECTURE.md).
- Dependencies on packages outside this monorepo keep their upstream names.

## Upstreams

- koishi — <https://github.com/koishijs/koishi> (MIT)
- webui — <https://github.com/koishijs/webui> (AGPL-3.0, some packages MIT)
- assets — <https://github.com/koishijs/assets> (MIT)
- common — <https://github.com/koishijs/common> (MIT)
- cordiverse/server — <https://github.com/cordiverse/server> (MIT)
- koishi-plugin-dataview — <https://github.com/koishijs/koishi-plugin-dataview> (AGPL-3.0)
- theme-vanilla — <https://github.com/koishijs/theme-vanilla> (AGPL-3.0)

## Syncing upstream changes

1. Clone or fetch the upstream repo at the release line you track (a local cache of upstream checkouts is useful; diffing needs the actual sources).
2. Diff the relevant upstream `packages/*` / `plugins/*` directory against the mapped directory here (see the table above).
3. Port changes by hand. Upstream sources use extension-less bundler-style relative imports; this repo type-checks under NodeNext, so **relative imports must carry the `.ts` extension** when ported.
4. Verify with `bun run build` + `bun test` (and `bun run check` when in doubt). Front-end changes additionally need `bun packages/web/client/src/bin.ts build <plugin-dir>`.
