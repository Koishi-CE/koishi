# 官方镜像（ghcr.io/koishi-ce/koishi）

Koishi CE 的成品容器镜像：内置默认模板的依赖与 `koishi.yml`，开箱即可运行，容器内仍可在控制台插件市场安装 / 卸载 / 更新插件。

- 与 `create-koishi-ce --docker` 的关系：那个方案面向**自己的项目**（有源码、可提交 `bun.lock`、可写自定义插件）；本镜像面向**不想构建项目**的场景（`docker run` 即用）。两者的工作区语义相同：`/app` 可写，配置与依赖写回 `/app`。
- 基础镜像 `oven/bun:1.4.2-debian`，支持 `linux/amd64` 与 `linux/arm64`。

## 快速开始

```bash
docker run -d --name koishi \
  -p 127.0.0.1:5140:5140 \
  -v koishi-data:/app \
  ghcr.io/koishi-ce/koishi:latest
```

打开 <http://127.0.0.1:5140>。首次启动时 entrypoint 检测到 `/app` 为空，会把镜像内 `/seed` 的初始工作区复制进去。

或使用 [compose.yaml](compose.yaml)：

```bash
docker compose up -d
```

默认只绑定 `127.0.0.1`；公网访问请加反向代理（需支持 WebSocket）。改宿主端口用 `HOST_PORT=8080 docker compose up -d`。

## 数据与持久化

- **`/app` 是唯一持久化边界**：`koishi.yml`、`package.json`、`bun.lock`、`node_modules`、`data/` 全在其中。请务必挂卷（命名卷或宿主目录），否则删除容器即丢。
- 命名卷：`-v koishi-data:/app`（跨重建保留，推荐）。
- 宿主目录：`-v "$PWD/koishi-data:/app"`（便于直接备份 / 避免 Windows 下宿主 `node_modules` 平台不匹配）。
- `bun-cache` 卷（`/home/bun/.bun/install/cache`）是可选的安装缓存，删掉只会让下次安装变慢。

## 插件市场

容器内安装 / 更新插件走真实的 `bun install`，结果写回 `/app`：

```bash
docker exec koishi bun --version    # 确认容器内可用
```

控制台完成安装后，宿主侧会看到 `package.json` / `bun.lock` / `koishi.yml` 变化（命名卷则用 `docker cp` 或临时容器查看）。`bun-cache` 卷让二次安装命中缓存。

## 升级语义（重要）

`docker pull` + 重建容器**只更新镜像本身**，不会覆盖已存在的 `/app` 卷：entrypoint 只在 `/app/package.json` 缺失时才从 `/seed` 初始化。

因此升级有两条路：

1. **保留工作区**（推荐）：拉新镜像后重建容器，插件在控制台内按需更新；`data/` 与配置原样保留。
2. **跟随新镜像的初始依赖集**：备份 `data/` 后删除 `/app` 卷并重新启动（会回到默认插件集，已装第三方插件需重装）。

镜像的 `latest` tag 跟随默认分支构建；`sha-<短哈希>` 与 `YYYYMMDD-<短哈希>` 用于固定版本与回滚。回滚时换回旧 tag 即可，数据库 schema 迁移由插件自身负责（向前兼容不保证，跨大版本升级前请先备份）。

## 备份

```bash
# 停容器后导出整个工作区
docker run --rm -v koishi-data:/app -v "$PWD":/backup alpine \
  tar czf /backup/koishi-backup.tgz -C /app .

# 恢复
docker run --rm -v koishi-data:/app -v "$PWD":/backup alpine \
  sh -c 'rm -rf /app/* && tar xzf /backup/koishi-backup.tgz -C /app'
```

或直接备份宿主机挂载目录（`data/` + `koishi.yml` + `package.json` + `bun.lock`）。

## 版本与可复现性

官方镜像在构建期用模板的 `^1.0.0` 区间解析当前最新的 `@koishi-ce/*` 1.x，**不提交 lockfile**：可复现性由镜像 digest 与 tag 保证，而不是仓库 lock。需要严格锁版本时，请用 `create-koishi-ce --docker` 在自己的项目里提交 `bun.lock` 后自建镜像。

## 本地构建

```bash
bun docker/official/prepare.ts     # 生成 seed/ 与 entrypoint 副本（不入库）
docker build -t koishi-ce:local docker/official
docker run --rm -p 5140:5140 -v koishi-data:/app koishi-ce:local
```

`prepare.ts` 从 `apps/koishi-create` 的默认模板生成 `seed/package.json`（prod 模式）与 `seed/koishi.yml`，并复制 `--docker` 模板的 entrypoint；生成物在 `.gitignore` 中，避免与模板双份维护漂移。

多架构构建：

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t koishi-ce:local docker/official
```

## 发布

`.github/workflows/image.yml` 在 Release 成功后自动构建并推送 GHCR（`linux/amd64,linux/arm64`），也可手动 `workflow_dispatch`。该 workflow 只持 `contents: read` + `packages: write`，不持 OIDC，与 npm 发布链隔离。

首次推送的 GHCR 包默认是 private：需要在仓库 Packages 设置里把 `koishi` 包改为 public，`docker pull` 才能匿名拉取；私有拉取则先 `docker login ghcr.io`。

## 安全

- 容器以镜像自带的 `bun` 用户（uid 1000）运行；entrypoint 会把 `/app` 属主对齐到 `1000:1000`。
- 控制台的 `auth` 插件默认未启用：公网部署前请在控制台启用认证，或在前置反向代理上做访问控制。
- 容器内可执行 `bun install`（插件市场的前提），因此 `/app` 必须可写；不要把根文件系统设为只读。
