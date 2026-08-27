# koishi-bun

A Bun-first community redistribution of [Koishi](https://koishi.chat) — the Koishi core and webui codebases restructured into a single monorepo.

> **Not affiliated with the Koishijs organization.** See [NOTICE.md](./NOTICE.md) for attribution and licensing (note: large parts originating from webui are AGPL-3.0), and [UPSTREAM.md](./UPSTREAM.md) for the upstream source mapping and sync workflow.

## Status

Early restructuring phase:

- [x] Merge koishi + webui into one Bun-workspace monorepo
- [ ] `bun install` green across all workspaces
- [ ] Replace the yarn + yakumo toolchain (build, test, publish)
- [ ] Decide the npm naming/publishing strategy

## Layout

- `packages/` — libraries that are imported (`core`, `loader`, `cli`, `client`, `console`, ...)
- `plugins/` — runtime plugins mounted by the Koishi loader
- `apps/` — deployable applications (website `online`, plugin `registry`)
- `tooling/` — build/release/CI helpers
