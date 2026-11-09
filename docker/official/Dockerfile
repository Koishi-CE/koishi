# syntax=docker/dockerfile:1

# Koishi CE 官方镜像（可变工作区）。
#
# 与 create-koishi-ce --docker 生成的镜像同构，区别只在：
# - 依赖与默认 koishi.yml 由本仓库模板在构建期生成（/seed），用户无需源码；
# - /app 是匿名/命名卷工作区，首次启动由 entrypoint 从 /seed 初始化；
# - 运行期仍支持控制台插件市场安装 / 卸载 / 更新，写回 /app 卷。
FROM oven/bun:1.4.2-debian AS seed

# 构建期预热初始依赖。官方镜像跟随 npm 上的 @koishi-ce 1.x 线，未提交
# lockfile：可复现性由镜像 digest 与 tag 保证，见 README「版本与可复现性」。
WORKDIR /seed
COPY seed/package.json ./package.json
COPY seed/koishi.yml ./koishi.yml
RUN bun install --production

FROM oven/bun:1.4.2-debian

# 运行时以 root 启动入口脚本，完成工作区初始化与属主对齐后降权到 bun。
# gosu 以 exec 方式切换用户，PID 1 仍是 Koishi CLI，SIGTERM 可直达。
# tzdata 必须显式安装：debian-slim 默认不含时区数据库，只设 TZ 不会生效。
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gosu tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /home/bun/.bun/install/cache \
 && chown -R bun:bun /home/bun/.bun

COPY --from=seed /seed /seed
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app
ENV NODE_ENV=production \
    HOME=/home/bun \
    TZ=Asia/Shanghai \
    KOISHI_HOST=0.0.0.0 \
    KOISHI_CONSOLE_OPEN=0

EXPOSE 5140

ENTRYPOINT ["docker-entrypoint.sh"]
# 直接指向 CLI 入口，避免 `bun run` 多包一层进程截断 SIGTERM
CMD ["bun", "node_modules/@koishi-ce/koishi/lib/cli/index.mjs", "start"]
