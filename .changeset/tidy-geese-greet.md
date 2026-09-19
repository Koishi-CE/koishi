---
"@koishi-ce/client": patch
---

修复底部状态栏项悬停 tooltip 的滚动条闪烁循环：popper 的 preventOverflow 原本 padding 为 0，弹层被允许贴死视口右缘，经典滚动条 + DPI 缩放环境下亚像素取整溢出会撑出 body 滚动条，进而顶起 footer 使鼠标脱离状态项，tooltip 反复开关形成闪烁。现给 preventOverflow 留 8px 安全边距使弹层不再贴边；另兜底 body overflow: hidden——控制台为全 fixed 布局，body 级滚动没有正当消费者，关闭后任何弹层瞬态溢出都不再产生滚动条
