# @koishi-ce/plugin-explorer

**简体中文** | [English](#english)

网页文件管理器插件，移植自上游 [koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/explorer`。它把服务器上的文件以树形视图展示在控制台中，内置 monaco 编辑器，支持在线查看与编辑文本文件、上传与下载。依赖 console 服务。

## 功能与页面

- 「资源管理器」页面：路由 `/files/:name*`（order 600）。左侧为文件树（目录、文件、符号链接三类节点），右侧为 monaco 编辑器；文件树右键菜单支持新建文件 / 文件夹、上传、下载、重命名与删除。
- 上传：支持拖拽与粘贴，经全局上传对话框写入服务器。
- 页面菜单：提供保存与刷新动作（对应 Ctrl+S / Ctrl+R 快捷键）。
- 路径选择控件：为 schema `role: "path"` 的字符串字段注册 FilePicker，其他插件的配置表单中路径字段会渲染为弹窗式路径选择器。
- 状态栏：右侧显示当前编辑文件的语言。
- RPC 接口（供浏览器执行实际文件操作，均要求权限 4）：

| RPC | 说明 |
| --- | --- |
| `explorer/read` | 读取文件，返回 base64 内容及探测出的 MIME 类型与文本编码 |
| `explorer/write` | 写入文件（文本或 base64 二进制） |
| `explorer/mkdir` | 创建目录 |
| `explorer/remove` | 删除文件或目录（递归） |
| `explorer/rename` | 重命名 / 移动 |
| `explorer/refresh` | 重新遍历并下发文件树 |

- 提供 `explorer` 数据服务，向控制台推送根目录的完整文件树。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `root` | string | `""` | 资源管理器的根目录，相对 `ctx.baseDir` 解析，默认为当前工作路径 |
| `ignored` | string[] | `["**/node_modules", "**/.*", "cache"]` | 要忽略的文件或目录，支持 Glob 语法 |

## 用法

需要先启用 `console`（@koishi-ce/plugin-console）。安装：

```bash
bun add @koishi-ce/plugin-explorer
```

也可以在控制台的插件市场中直接安装。随后在配置文件中启用：

```yaml
plugins:
  explorer: {}
```

## 备注

- 所有文件操作 RPC 的路径参数均为相对 `root` 的路径，写操作完成后自动刷新文件树。
- 文件树排序：目录在最前，其余按名称字母序；被 `ignored` 规则命中的路径不展示。
- 符号链接作为独立节点展示，并附其指向的目标路径。
- 二进制文件按 base64 传输。
- 文本文件的编码由 chardet 探测，MIME 类型由文件头字节探测。
- 无指令、无数据表。

## 许可证

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt)。版权归 Shigma 及 Koishijs 贡献者（上游）与 Koishi-CE 贡献者，见 [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE)。上游仓库：[koishijs/webui](https://github.com/koishijs/webui) 的 `plugins/explorer`。

---

## English

Web-based file manager plugin, ported from `plugins/explorer` of the upstream [koishijs/webui](https://github.com/koishijs/webui) repository. It presents server files as a tree in the console with a built-in monaco editor, supporting online viewing and editing, upload, and download. Depends on the console service.

## Features and Pages

- "Explorer" page: route `/files/:name*` (order 600). File tree on the left (files, directories, symlinks), monaco editor on the right; the tree context menu supports create file / directory, upload, download, rename, and delete.
- Upload via drag-and-drop or paste, handled by a global upload dialog; page menus provide save and refresh actions (Ctrl+S / Ctrl+R).
- Registers a FilePicker component for schema string fields with `role: "path"`, so path fields in other plugins' config forms render as a dialog-based picker.
- Status bar shows the language of the file being edited.
- RPC endpoints (all authority 4): `explorer/read` (returns base64 content with detected MIME type and encoding), `explorer/write`, `explorer/mkdir`, `explorer/remove` (recursive), `explorer/rename`, `explorer/refresh`.
- Provides the `explorer` data service that pushes the full file tree of the root directory.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | string | `""` | Root directory, resolved against `ctx.baseDir` |
| `ignored` | string[] | `["**/node_modules", "**/.*", "cache"]` | Glob patterns of files and directories to ignore |

## Usage

Requires `console` (@koishi-ce/plugin-console) to be enabled first.

```bash
bun add @koishi-ce/plugin-explorer
```

The plugin can also be installed from the console plugin market, then enabled in the config file:

```yaml
plugins:
  explorer: {}
```

## Notes

- All RPC paths are relative to `root`; the tree refreshes automatically after writes.
- Directories sort first, then alphabetical order; ignored paths are hidden.
- Symlinks appear as distinct nodes with their target paths.
- No commands, no tables.

## License

[AGPL-3.0](https://github.com/Koishi-CE/koishi/blob/main/LICENSES/AGPL-3.0.txt). Copyright belongs to Shigma and Koishijs contributors (upstream) and Koishi-CE contributors; see [NOTICE](https://github.com/Koishi-CE/koishi/blob/main/NOTICE). Upstream: [koishijs/webui](https://github.com/koishijs/webui), `plugins/explorer`.
