/**
 * 类型侧与运行时同构：把 `@koishijs/loader` 名字的类型解析指回
 * @koishi-ce/loader。日常开发一律 `import ... from "@koishi-ce/*"`（见
 * AGENTS.md 硬性约束），本文件仅在社区包以上游名被类型程序消费时兜底。
 */
export * from "@koishi-ce/loader";
export { default } from "@koishi-ce/loader";
