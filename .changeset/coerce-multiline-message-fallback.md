---
"@koishi-ce/utils": patch
---

`coerce` 在消息含换行时不再把错误文本退化成一行裸栈帧：

- 背景（实测于 CI 偶发红）：`coerce` 用 `findIndex(line => line.endsWith(message))` 定位消息行，**消息含换行时没有任何一行以整条消息结尾**，`findIndex` 返回 `-1`，而 `lines.slice(-1)` 恰好只留下最外层栈帧——调用方（控制台前端、命令与中间件的错误渲染）拿到的「错误消息」就变成一行 `    at ...`，消息本体完全丢失。触发形态：把一次 `coerce` 的文本再包成 `Error`（`new Error(coerced)`），或任何自带多行 message 的异常；
- 修法：快路径不变（整条消息结尾定位，保留原有「丢弃无关外层帧」语义）；定位失败时回退为「消息首行结尾定位」（堆栈首行恒为 `Error: <消息首行>`）；仍定位不到（如堆栈被替换）则把消息补回栈首，保证消息本体不丢；
- 用例：`packages/node/utils` 新增两条单测（多行消息、栈中无消息的兜底），`packages/node/console` RPC 层新增一条端到端回归（多行消息异常仍回传消息本体）。
