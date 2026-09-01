# @koishi-ce/plugin-oobe

**简体中文** | [English](#english)

首次启动引导插件（Out-Of-the-Box Experience），移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/oobe`。

本插件是一个 Node 侧占位包：`apply` 为空实现，自身不承载任何指令、配置或数据服务。首次启动引导流程的全部实现位于浏览器端的共享控制台前端——新初始化的应用首次打开控制台时，由引导流程带领用户完成基础配置。本包的作用是让这套引导机制作为一个可识别的包出现在市场与配置层中。

## 功能与页面

本插件没有独立页面。引导流程的界面由共享控制台前端在首次启动时自动呈现，完成引导后不再出现。

## 配置项

本插件无需配置。

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-oobe
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  oobe: {}
```

## 备注

- Node 侧源码（`src/index.ts`）仅保留插件骨架：声明 console 服务依赖与空配置 schema，满足 console 插件的包结构约定。
- 引导流程的实际逻辑与界面位于 `@koishi-ce/client` 浏览器端资源中。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/oobe`。

---

## English

Out-Of-the-Box Experience plugin, ported from `plugins/oobe` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository.

This package is a Node-side placeholder: `apply` is an empty implementation with no commands, config, or data services. The first-run setup wizard is implemented entirely in the shared browser-side console frontend — when a freshly initialized app opens the console for the first time, the wizard walks the user through basic configuration. This package exists so that the wizard is recognizable by the market and configuration layers.

## Configuration

None.

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-oobe
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  oobe: {}
```

## Notes

- The Node-side source keeps only the plugin skeleton; the actual wizard lives in the browser-side resources of `@koishi-ce/client`.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/oobe`.
