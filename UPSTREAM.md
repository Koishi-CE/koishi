# Upstream tracking

This repository was bootstrapped by merging two upstream repositories as plain file copies (no git history was preserved) and restructuring them. Porting upstream changes therefore has to be done manually, by diffing against an upstream checkout.

Snapshot started from:

- [ ] koishi: `<tag or commit>` — fill in when known
- [ ] webui: `<tag or commit>` — fill in when known

## Restructure map

| This repo | Upstream |
| --- | --- |
| `packages/node/cli` | koishi `packages/koishi` (renamed to `@koishi-ce/koishi`) |
| `packages/node/{core,loader,utils,i18n-utils}` | koishi `packages/*` (unchanged) |
| `packages/node/console` | webui `packages/console` |
| `packages/web/{client,components,market}` | webui `packages/*` |
| `apps/{online,registry}` | webui `packages/*` |
| `plugins/infra/{http,server,hmr,mock,proxy-agent}` | koishi `plugins/*` |
| `plugins/common/{bind,broadcast,callme,echo,help,inspect}` | koishi `plugins/common/*` |
| the 16 `plugins/webui/*` | webui `plugins/*` |
| `tsconfig.client.json` | webui `tsconfig.client.json` |
| `apps/online/vercel.json` | webui `vercel.json` |
|  `LICENSES/webui-AGPL-3.0.txt` | webui `LICENSE` |
| root `package.json`, `tsconfig.json`, `yakumo.yml` | rewritten (merged from both repo roots) |

Local regrouping (upstream packages are flat `packages/*` / `plugins/*`): `packages/node` and `packages/web` split by runtime, `plugins/{common,infra,webui}` split by origin/role. Upstream package names map here to the `@koishi-ce` scope (`@koishijs/X` → `@koishi-ce/X`, `koishi` → `@koishi-ce/koishi`); dependencies on packages outside this monorepo keep their upstream names, and `peerDependencies` still target the published upstream runtime. Sync by mapping the upstream package name to its directory here via the table above.

Everything else at the repo root (README, NOTICE, biome.json, ...) is new.

## Upstreams

- koishi — <https://github.com/koishijs/koishi> (MIT)
- webui — <https://github.com/koishijs/webui> (AGPL-3.0, some packages MIT)

## Syncing upstream changes

1. Clone or fetch the upstream repo at the tag you track.
2. Diff the relevant upstream `packages/*` / `plugins/*` directory against the mapped directory here (see the table above).
3. Port changes by hand; run `bun run build` / `bun run test` afterwards.
