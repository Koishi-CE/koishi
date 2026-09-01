# @koishi-ce/plugin-mock

**简体中文** | [English](#english)

Koishi 的测试模拟基础设施，移植自上游 [koishijs/koishi](https://github.com/koishijs/koishi) 的 `plugins/mock`，面向插件与机器人的自动化测试。它提供一个 `mock` 平台的虚拟适配器与消息客户端：不连接任何真实聊天平台即可构造会话、断言机器人的回复、模拟 HTTP 请求。

## 测试 API

- **MockBot / MockAdapter**：`mock` 平台的虚拟机器人与适配器。适配器上可：
  - `initUser(id, authority?, data?)` / `initChannel(id, assignee?, data?)` 预置用户与频道；
  - `client(userId, channelId?)` 获取消息客户端；`session(event)` 直接构造会话；
  - `webhook` 属性获取 HTTP 测试器。
- **MessageClient**：模拟一个聊天中的用户——
  - `receive(content, count?)`：发送消息并等待机器人的回复（支持 `<quote>` 前缀引用）；
  - `shouldReply(message, reply?)`：断言机器人对某消息的回复（字符串全等、正则或数组逐项）；
  - `shouldNotReply(message)`：断言不回复。
- **Webhook**：`head` / `get` / `delete` / `post` / `put` / `patch` / `receive`，直接向 plugin-server 底层 HTTP 服务派发请求，不经过真实网络。

## 用法

```bash
bun add @koishi-ce/plugin-mock
```

```ts
import { MockBot, MockAdapter } from "@koishi-ce/plugin-mock";

const adapter = app.mock;
const client = adapter.client("123", "456");
await client.shouldReply("echo 你好", "你好");
```

配合 `bun test` 编写插件的回归测试（本仓库自身的测试即大量使用本插件）。

## 配置项

本插件无需配置（MockBot 可选 `selfId`，缺省 "514"）。

## 许可证

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE)。本包是上游 koishijs/koishi 的社区再分发，版权归属见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。

---

## English

Test mocking infrastructure for Koishi, ported from `plugins/mock` of the upstream [koishijs/koishi](https://github.com/koishijs/koishi), for automated testing of plugins and bots. It provides a virtual `mock` platform adapter and a message client: construct sessions, assert bot replies and simulate HTTP requests without connecting to any real chat platform.

## Testing API

- **MockBot / MockAdapter** — the virtual bot and adapter of the `mock` platform. On the adapter you can:
  - `initUser(id, authority?, data?)` / `initChannel(id, assignee?, data?)` to preset users and channels;
  - `client(userId, channelId?)` to obtain a message client; `session(event)` to build a session directly;
  - use the `webhook` property as an HTTP tester.
- **MessageClient** — simulates a user in a chat:
  - `receive(content, count?)` — send a message and collect the bot's replies (a `<quote>` prefix quotes a message);
  - `shouldReply(message, reply?)` — assert the reply to a message (exact string, regex, or item-by-item array);
  - `shouldNotReply(message)` — assert silence.
- **Webhook** — `head` / `get` / `delete` / `post` / `put` / `patch` / `receive`, dispatching requests straight into the plugin-server's underlying HTTP service, bypassing the real network.

## Usage

```bash
bun add @koishi-ce/plugin-mock
```

```ts
import { MockBot, MockAdapter } from "@koishi-ce/plugin-mock";

const adapter = app.mock;
const client = adapter.client("123", "456");
await client.shouldReply("echo hello", "hello");
```

Pairs well with `bun test` for plugin regression suites (this repository's own tests use it heavily).

## Configuration

None (MockBot accepts an optional `selfId`, default "514").

## License

[MIT](https://github.com/Koishi-CE/koishi/blob/main/LICENSE). Community redistribution of upstream koishijs/koishi; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE) for attribution.
