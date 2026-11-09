# Koishi 机器人项目

由 `bun create koishi-ce` 生成，运行于 [@koishi-ce 社区再分发版](https://github.com/Koishi-CE/koishi) 生态。

## 环境要求

- [Bun](https://bun.sh) ≥ 1.2（本项目唯一支持的运行时与包管理器：koishi CLI 与插件加载链均以 Bun 为准）

## 快速开始

```bash
bun install
bun run start        # 启动（生产模式）
bun run dev          # 启动（开发模式，启用 HMR 热更新）
```

启动后访问控制台：<http://127.0.0.1:5140>

## 容器部署（Docker Compose）

用 `bun create koishi-ce --docker` 生成时，项目自带 `Dockerfile`、`docker-entrypoint.sh`、`compose.yaml` 与 `.dockerignore`：

```bash
docker compose up -d --build
```

打开控制台 <http://127.0.0.1:5140>。容器是**可变工作区**：控制台插件市场的安装 / 卸载 / 更新、配置保存都会直接写回宿主项目目录，`docker compose down && docker compose up -d` 后全部保留。

- **持久化边界**：`compose.yaml` 用目录级挂载 `.:/app`（不要改成单文件挂载 `koishi.yml`——Linux 下单文件 bind mount 绑定的是 inode，控制台写回或编辑器原子保存会让 inode 悬空、报 `EBUSY`）。`koishi.yml`、`package.json`、`bun.lock`、`node_modules` 与 `data/` 都在宿主目录里。
- **端口**：容器内固定 5140；改宿主端口用 `HOST_PORT=8080 docker compose up -d`。容器默认只绑定 `127.0.0.1`，公网访问请加反向代理（需支持 WebSocket）。
- **时区**：默认 `TZ=Asia/Shanghai`，改环境变量即可。
- **权限**：容器以镜像自带的 `bun` 用户（uid 1000）运行，entrypoint 会自动把挂载目录属主对齐到 `1000:1000`；Linux / WSL2 默认用户即 1000，通常无需手动 `chown`。
- **依赖锁**：请提交 `bun.lock`。有锁时构建与首启都走 `--frozen-lockfile`；没有锁时退化为普通安装（首次会生成锁文件）。
- **插件市场**：容器内安装 / 更新插件走真实的 `bun install`，`bun-cache` 命名卷缓存安装包，二次安装可命中缓存。
- **无源码部署**：把 `compose.yaml` 中的 `.:/app` 换成 `koishi-data:/app`，镜像会用内置的 `/seed` 初始化一个空工作区。
- **备份**：停止容器后复制 `data/` 与 `koishi.yml` 即可；sqlite 的 WAL 在容器停止时已收敛。
- **Windows 注意**：宿主 `node_modules` 若由 Windows 安装，Linux 容器内不可用；建议先删除宿主 `node_modules` 再启动，或改用命名卷模式。

## 预装与预写

- **已预装**：基础与控制台插件（@koishi-ce 全家桶）。`koishi.yml` 为配置页导出形态：插件键带 uid 实例后缀，分组带中文 `$label` 标签。其中依赖数据库但非必需的（admin / bind / broadcast / callme / auth）与暂无需启用的（inspect / server-temp / mock）以 `~` 前缀保持禁用——数据库已默认启用，去掉对应 `~` 即可。
- **数据库开箱即用**：`@koishi-ce/plugin-database-sqlite` 已预装并默认启用，数据落在 `data/koishi.db`。
- **只预写、未预装**：adapter（discord / telegram / qq …）官方插件以 `~` 禁用条目预写在 `koishi.yml` 的 `group:adapter`——loader 会跳过禁用条目，不安装也能正常启动；需要时在控制台「插件市场」搜索安装，回到配置页点击启用即可（mongo / mysql / postgres 等其他数据库插件未预写占位，市场安装后自动出现条目）。

## 安装插件

推荐在控制台「插件市场」页安装（已预配 registry.koishi.chat 镜像源）；也可以手动 `bun add <包名>` 后在 `koishi.yml` 中启用。

根依赖中的六行 npm alias——`"koishi": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/plugin-console": "npm:@koishi-ce/console-shim@^5.30.11"`、`"@koishijs/core": "npm:@koishi-ce/koishi-shim@4.18.11"`、`"@koishijs/loader": "npm:@koishi-ce/koishi-shim@^4.18.11"`、`"@koishijs/client": "npm:@koishi-ce/client-shim@^5.30.11"`、`"@koishijs/components": "npm:@koishi-ce/components-shim@^1.5.22"`——已把上游生态的 peer 与 dependencies 声明全部钉回 @koishi-ce 对应包（涉及 koishi-shim / console-shim / client-shim / components-shim 四个包；**请勿删除或改写这六行**），不会形成第二份框架 / console / 前端库副本。

## 更新依赖

```bash
bun run update        # 安全更新：只更新 @koishi-ce/* 生态位依赖
```

**请勿裸跑 `bun update`**：那是全树更新语义，会连带给市场安装的第三方插件与全部传递依赖重新求解，任一上游漂移都可能破坏运行时。`bun run update` 只显式更新 `@koishi-ce/*` 依赖（alias 冻结线不受影响）；第三方插件的版本请经控制台「插件市场」操作。

## 自定义插件

手动在 `plugins/` 目录下创建插件包，或经脚手架进入 `external/` 工作区：

- `bun run new <名称>` —— 生成插件骨架到 `external/`（`--console` 附带控制台前端扩展）
- `bun run clone <仓库>` —— 克隆已有插件源码到 `external/` 本地联动调试

两种来源的插件都在 `koishi.yml` 中以相对路径引用（如 `./plugins/my-plugin`、`./external/my-plugin`）即可启用；Bun 直接加载 TypeScript 源码，无需预编译。克隆来的 **monorepo 形态插件仓库**（插件在 `packages/` 等子目录）无需平铺——`workspaces` 声明的 `external/**` 通配任意深度，控制台「添加插件」列表同样按此声明收录，子包直接可见可启用（搬迁自其它包管理器的仓库若带着旧 `node_modules`，负向声明已将其排除，建议顺手删除节省空间）。

## 插件构建与发布

针对 `external/` 工作区的插件项目：

- `bun run build` —— 串行构建 `external/` 下全部可构建项目
- `bun run release:version` —— 消费 pending changeset 提升版本号
- `bun run release:dryrun` —— 完整发布链演练（version → build → publish --dry-run）
- `bun run release` —— 完整发布链（version → build → publish）
