# syntax=docker/dockerfile:1

# Koishi CE 可变工作区镜像。
#
# 设计前提：容器内必须能在控制台插件市场安装 / 卸载 / 更新插件，且
# koishi.yml、package.json、bun.lock、node_modules 与 data/ 在容器重启或
# 重建后完整保留。因此 /app 是工作区（通常直接挂载宿主机项目目录），
# /seed 只保存首次启动用的初始文件。
FROM oven/bun:1.4.2-debian

# 构建期在 /seed 预热初始依赖：首次挂载空卷时直接复制，无需联网安装。
# 有 bun.lock 时严格按锁文件安装；没有锁文件时退化为普通安装（首次
# 构建会生成锁文件，之后请把它提交进仓库）。
WORKDIR /seed
COPY package.json bun.lock* ./
RUN if [ -f bun.lock ]; then \
        bun install --frozen-lockfile --production; \
    else \
        bun install --production; \
    fi \
    && rm -rf /root/.bun/install/cache
COPY koishi.yml /seed/koishi.yml

# 运行时以 root 启动入口脚本，完成工作区初始化与属主对齐后降权到 bun。
# gosu 以 exec 方式切换用户，PID 1 仍是 Koishi CLI，SIGTERM 可直达。
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /home/bun/.bun/install/cache \
 && chown -R bun:bun /home/bun/.bun

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /app
# HOME 指向 bun 用户：市场安装 / 更新插件时 Bun 缓存落到 compose 的
# bun-cache 卷，二次安装可命中缓存
ENV NODE_ENV=production \
    HOME=/home/bun \
    TZ=Asia/Shanghai \
    KOISHI_HOST=0.0.0.0 \
    KOISHI_CONSOLE_OPEN=0

EXPOSE 5140

ENTRYPOINT ["docker-entrypoint.sh"]
# 直接指向 CLI 入口，避免 `bun run` 多包一层进程截断 SIGTERM
CMD ["bun", "node_modules/@koishi-ce/koishi/lib/cli/index.mjs", "start"]
