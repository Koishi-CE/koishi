---
"@koishi-ce/loader": patch
---

修复插件启动可能冻结数十秒的种子遍历黑洞：CJS interop 预置的依赖树遍历不再沿 peerDependencies 展开。koishi 生态插件普遍 peer 框架本体，原实现会从每个插件爬上 cordis / satori / minato 全家直至包数上限，叠加 isolated 布局下的逐层定位，实测单实例产生约 28 万次文件系统探测、启动日志在 apply plugin 后停顿 50~136 秒。排除 peer 后实测回秒级，dependencies / optionalDependencies 的分歧修复行为不变。
