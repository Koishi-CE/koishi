# NOTICE

**koishi-bun** is a community redistribution of the [Koishi](https://koishi.chat) chatbot framework. It is not affiliated with, endorsed by, or maintained by the Koishijs organization.

This repository is a derivative work combining code from two upstream repositories, restructured into a single monorepo. Per-directory provenance and licensing:

| Directory | Upstream | License |
| --- | --- | --- |
| `packages/core`, `packages/loader`, `packages/utils`, `packages/i18n-utils`, `packages/cli` | [koishijs/koishi](https://github.com/koishijs/koishi) `packages/*` | MIT — [LICENSE](./LICENSE) |
| `plugins/http`, `plugins/server`, `plugins/hmr`, `plugins/mock`, `plugins/proxy-agent` | [koishijs/koishi](https://github.com/koishijs/koishi) `plugins/*` | MIT — [LICENSE](./LICENSE) |
| `plugins/bind`, `plugins/broadcast`, `plugins/callme`, `plugins/echo`, `plugins/help`, `plugins/inspect` | [koishijs/koishi](https://github.com/koishijs/koishi) `plugins/common/*` | MIT — [LICENSE](./LICENSE) |
| `packages/client`, `packages/components`, `packages/market` | [koishijs/webui](https://github.com/koishijs/webui) `packages/*` | AGPL-3.0 — [LICENSES/webui-AGPL-3.0](./LICENSES/webui-AGPL-3.0) |
| `plugins/actions`, `plugins/admin`, `plugins/analytics`, `plugins/auth`, `plugins/commands`, `plugins/config`, `plugins/console`, `plugins/explorer`, `plugins/insight`, `plugins/locales`, `plugins/logger`, `plugins/market`, `plugins/notifier`, `plugins/oobe`, `plugins/sandbox`, `plugins/status` | [koishijs/webui](https://github.com/koishijs/webui) `plugins/*` | AGPL-3.0 — [LICENSES/webui-AGPL-3.0](./LICENSES/webui-AGPL-3.0) |
| `apps/online` | [koishijs/webui](https://github.com/koishijs/webui) `packages/online` | AGPL-3.0 — [LICENSES/webui-AGPL-3.0](./LICENSES/webui-AGPL-3.0) |
| `packages/console`, `apps/registry` | [koishijs/webui](https://github.com/koishijs/webui) | MIT (declared in the upstream package.json of each package) |

Copyright (c) 2019-present Shigma and Koishijs contributors.

The AGPL-3.0 licensed portions above remain under AGPL-3.0 in this repository; the MIT portions remain under MIT. Distributing this combined work, or offering it as a network service, triggers AGPL-3.0 obligations (including source disclosure) for the AGPL-3.0 portions. This notice is informational and is not legal advice.
