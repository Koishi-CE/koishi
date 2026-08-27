# Upstream tracking

This repository was bootstrapped by merging two upstream repositories as plain file copies (no git history was preserved) and restructuring them. Porting upstream changes therefore has to be done manually, by diffing against an upstream checkout.

Snapshot started from:

- [ ] koishi: `<tag or commit>` — fill in when known
- [ ] webui: `<tag or commit>` — fill in when known

## Restructure map

| This repo | Upstream |
| --- | --- |
| `packages/cli` | koishi `packages/koishi` (npm package name stays `koishi`) |
| `packages/{core,loader,utils,i18n-utils}` | koishi `packages/*` (unchanged) |
| `packages/{client,components,console,market}` | webui `packages/*` |
| `apps/{online,registry}` | webui `packages/*` |
| `plugins/{http,server,hmr,mock,proxy-agent}` | koishi `plugins/*` |
| `plugins/{bind,broadcast,callme,echo,help,inspect}` | koishi `plugins/common/*` (flattened one level) |
| the 16 remaining `plugins/*` | webui `plugins/*` (flattened) |
| `tsconfig.client.json` | webui `tsconfig.client.json` |
| `apps/online/vercel.json` | webui `vercel.json` |
| `LICENSES/webui-AGPL-3.0` | webui `LICENSE` |
| root `package.json`, `tsconfig.json`, `yakumo.yml` | rewritten (merged from both repo roots) |

Everything else at the repo root (README, NOTICE, biome.json, ...) is new.

## Upstreams

- koishi — <https://github.com/koishijs/koishi> (MIT)
- webui — <https://github.com/koishijs/webui> (AGPL-3.0, some packages MIT)

## Syncing upstream changes

1. Clone or fetch the upstream repo at the tag you track.
2. Diff the relevant upstream `packages/*` / `plugins/*` directory against the mapped directory here (see the table above).
3. Port changes by hand; run `bun run build` / `bun run test` afterwards.
