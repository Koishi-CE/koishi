
<div align="center">

<h1 id="koishi">
  <a href="https://koishi.chat/" target="_blank">
    <img src=".github/assets/koishi-ce-wordmark.svg" alt="Koishi-CE" width="514">
  </a>
</h1>

**高性能、零 Node 依赖的 Koishi 社区再分发版**

[![CI](https://img.shields.io/github/actions/workflow/status/Koishi-CE/koishi/ci.yml?style=flat-square&label=CI)](https://github.com/Koishi-CE/koishi/actions/workflows/ci.yml)
&emsp;
[![codecov](https://img.shields.io/codecov/c/gh/Koishi-CE/koishi?style=flat-square&logo=codecov)](https://codecov.io/gh/Koishi-CE/koishi)
&emsp;
[![Bun](https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square&logo=bun)](https://bun.sh)
&emsp;
[![License](https://img.shields.io/badge/license-MIT%20%2F%20AGPL--3.0-blue?style=flat-square)](./NOTICE)

<p>
  <a href="./docs/README.md">文档</a> •
  <a href="#english">English</a>
</p>

</div>

> [!NOTE]
> **非官方社区版声明**：本项目与 [Koishi 官方组织](https://github.com/koishijs) 无隶属关系。基于 [koishijs/koishi](https://github.com/koishijs/koishi) (MIT) 与 [koishijs/webui](https://github.com/koishijs/webui) (部分 AGPL-3.0) 源码按文件级重构为单仓发布。详见 [NOTICE](./NOTICE) 与 [上游对齐映射](./docs/process/upstream.md)

---

## 特性

* **运行时升级**\
　　以 [Bun](https://bun.sh) 为核心运行时与包管理器，使用了大量Bun原生模块
* **工具链升级**\
　　一条 `bun run check` 串起八段门禁，配套 release 发布链、沙盒实例生成器与上游巡检等 tooling 脚本

<!-- -->

* **上游单仓合并**\
　　将上游的框架核心与 WebUI 控制台融合为统一单仓（Monorepo）
* **严格工程约束**\
　　全仓严格类型检查，全量测试覆盖，严防死代码与脏依赖，产物纯 ESM 规范化

---

## 部署

只需一条命令即可初始化全新实例：

```bash
bun create koishi-ce
```

<details>
<summary>点击查看部署演示</summary>

<img src=".github/assets/Deploy.webp" alt="Koishi-CE 部署演示" width="600">

</details>

> [!TIP]
> 模板项目通过 npm alias 锁住上游依赖避免版本冲突。用户可从插件市场自行添加插件

---

## 维护

* **文档指南**：[项目架构与包清单](https://www.google.com/search?q=./docs/reference/architecture.md&utm_source=gemini) ｜ [开发与维护流程](https://www.google.com/search?q=./docs/README.md&utm_source=gemini)
* **代码治理**：[贡献指南](https://www.google.com/search?q=./.github/CONTRIBUTING.md&utm_source=gemini) ｜ [仓库约定](https://www.google.com/search?q=./AGENTS.md&utm_source=gemini) ｜ [安全策略](https://www.google.com/search?q=./.github/SECURITY.md&utm_source=gemini)
* **授权说明**：MIT 与 AGPL-3.0 分区授权，各目录源码出处见 [NOTICE](https://www.google.com/search?q=./NOTICE&utm_source=gemini)

---

## 项目状态

[![Repobeats analytics image](https://repobeats.axiom.co/api/embed/ee61d9e9a3df7762af021f96fec6d3990f6a961f.svg "Repobeats analytics image")](https://github.com/Koishi-CE/koishi/pulse)

---

## English

Koishi-CE is a **Bun-first community redistribution** of the [Koishi](https://koishi.chat?utm_source=gemini) chatbot framework. It reorganizes [koishijs/koishi](https://github.com/koishijs/koishi?utm_source=gemini) (MIT) and [koishijs/webui](https://github.com/koishijs/webui?utm_source=gemini) (partly AGPL-3.0) into an integrated monorepo published under `@koishi-ce`.

```bash
bun create koishi-ce
```

*Not affiliated with the official Koishijs organization. See [NOTICE](https://www.google.com/search?q=./NOTICE&utm_source=gemini) for license details.*

