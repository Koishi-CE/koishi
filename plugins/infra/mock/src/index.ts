/**
 * mock 插件入口：汇总再导出模拟适配器（adapter）、
 * 消息客户端（client）与 HTTP 测试工具（webhook）。
 * 默认导出 MockBot，使 mock 可作为插件加载并向 ctx 注入 mock 服务。
 */
import { MockBot } from "./adapter";

export * from "./adapter";
export * from "./client";
export * from "./webhook";

export default MockBot;
