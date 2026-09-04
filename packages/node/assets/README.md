# @koishi-ce/assets

**简体中文** | [English](#english)

Koishi 的资源服务抽象基类，移植自上游 [koishijs/assets](https://github.com/koishijs/assets) 仓库的 `packages/core`。「资源」指消息中的媒体文件（图片、音频、视频等）：抽象层负责识别与转换消息中的媒体元素，具体的持久化方式由派生插件实现——第一方实现是 [`@koishi-ce/plugin-assets-local`](https://github.com/Koishi-CE/koishi/tree/main/plugins/common/assets-local)（本地目录存储），插件作者也可以按同一接口实现自己的资源后端。

## 主要导出（单文件包）

默认导出 `Assets` 抽象基类，以 `assets` 为服务名注入 `ctx.assets`：

- `transform(content)`：遍历消息中的媒体元素，命中 `whitelist` 白名单前缀的 URL 原样保留，其余交由派生类持久化并替换为可访问 URL——供宿主在发送消息前调用（本包不自动挂载发送钩子）；
- `analyze(url, name)`：受保护方法，经 `ctx.http` 拉取远端文件，计算 sha1 摘要并按文件魔数（file-type）探测扩展名；
- 抽象方法 `upload(url, file)`（返回可访问 URL）与 `stats()`（存量统计）；
- 命名空间类型 `Assets.Config`（whitelist 白名单）、`Assets.Stats`（assetCount / assetSize）、`Assets.FileInfo`。

## 用法（面向插件作者）

```ts
import Assets from "@koishi-ce/assets";
import type { Context } from "@koishi-ce/core";

class MyAssets extends Assets<Assets.Config> {
  async upload(url: string, file: Assets.FileInfo) { /* 持久化并返回 URL */ }
  async stats() { return { assetCount: 0, assetSize: 0 }; }
}

export function apply(ctx: Context, config: Assets.Config) {
  ctx.plugin(MyAssets, config);
}
```

普通用户安装派生实现（如 `@koishi-ce/plugin-assets-local`）即可，无需直接依赖本包。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/assets 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

The abstract assets service for Koishi, ported from `packages/core` of the upstream [koishijs/assets](https://github.com/koishijs/assets) repository. "Assets" are media files in messages (images, audio, video). This package identifies and transforms media elements in outgoing messages; the actual persistence is implemented by derived plugins — the first-party implementation is [`@koishi-ce/plugin-assets-local`](https://github.com/Koishi-CE/koishi/tree/main/plugins/common/assets-local), and plugin authors can build their own backends on the same interface.

## Key exports (single-file package)

The default export `Assets` registers itself as the `assets` service (`ctx.assets`):

- `transform(content)` — walks media elements in a message, leaves whitelisted URLs untouched, and persists the rest through the subclass, replacing them with accessible URLs; meant to be invoked by the host before a message is sent (this package does not hook message sending on its own).
- `analyze(url, name)` — fetches the remote file via `ctx.http`, computes a sha1 digest and detects the extension from magic bytes (file-type).
- Abstract methods `upload(url, file)` (returns an accessible URL) and `stats()`.
- Namespace types `Assets.Config` (whitelist), `Assets.Stats`, `Assets.FileInfo`.

## Usage (for plugin authors)

```ts
import Assets from "@koishi-ce/assets";
import type { Context } from "@koishi-ce/core";

class MyAssets extends Assets<Assets.Config> {
  async upload(url: string, file: Assets.FileInfo) { /* persist and return a URL */ }
  async stats() { return { assetCount: 0, assetSize: 0 }; }
}

export function apply(ctx: Context, config: Assets.Config) {
  ctx.plugin(MyAssets, config);
}
```

End users install a derived implementation such as `@koishi-ce/plugin-assets-local` instead of this package.

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/assets; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
