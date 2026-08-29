# koishi

A Bun-first community redistribution of [Koishi](https://koishi.chat) — the Koishi core and webui codebases restructured into a single monorepo. Published under the GitHub organization [Koishi-CE](https://github.com/Koishi-CE) and the npm scope `@koishi-ce`.

> **Not affiliated with the Koishijs organization.** See [NOTICE.md](./NOTICE.md) for attribution and licensing (note: large parts originating from webui are AGPL-3.0), and [UPSTREAM.md](./UPSTREAM.md) for the upstream source mapping and sync workflow.

## Status

Early restructuring phase:

- [x] Merge koishi + webui into one Bun-workspace monorepo
- [x] Package management on Bun — `workspace:*` links, `bun.lock`, yakumo removed
- [x] Decide the npm naming/publishing strategy — packages renamed to the `@koishi-ce` scope (`koishi` → `@koishi-ce/koishi`, command name unchanged); repo metadata points at Koishi-CE/koishi
- [x] Dependency modernization phases 0–4 — vite 8 / TypeScript 7 / tsdown / biome 2.5, tests migrated to `bun test` (mocha removed, chai kept); cordis 4 (phase 5) blocked upstream, see `docs/upgrade-plan.md`
- [ ] Strict-mode type cleanup beyond `packages/node/*` (webui plugin clients, `packages/web/*`, `apps/online` still have errors)
- [ ] Zero-build exports for node packages; vite build for client packages

## Layout

- `packages/node/` — libraries that run on Node (`core`, `loader`, `cli`, `console`, `utils`, `i18n-utils`), built together by the root tsdown config into dual-format `lib/` output
- `packages/web/` — libraries that run in the browser (`client`, `components`); consumed as source by the console bundler, no standalone build
- `plugins/common/` — general-purpose bot plugins (`bind`, `broadcast`, `callme`, `echo`, `help`, `inspect`)
- `plugins/infra/` — infrastructure plugins (`hmr`, `mock`, plus vendored prebuilt `http`, `server`, `proxy-agent`)
- `plugins/webui/` — console/webui plugins (`admin`, `auth`, `config`, ...) — node side in `src/`, Vue side in `client/` (upstream convention)
- `apps/` — deployable applications: `online` (koishi.online website), `registry` (npm plugin scanner), `koishi-create` (`create-koishi-ce` scaffold CLI), `koishi-scripts` (plugin dev CLI)
- `tooling/` — build/release/CI helpers (an archived upstream yakumo config and the repo typecheck script)
- `docs/` — development guide and architecture notes (start at `docs/README.md`); repo-wide agent conventions live in `AGENTS.md`
