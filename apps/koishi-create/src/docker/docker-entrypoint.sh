#!/bin/sh
# Koishi CE 容器入口。
#
# 职责（顺序固定）：
#   1. 空工作区 → 用 /seed 初始化（首次挂载空卷 / 空目录）
#   2. 补齐 data/ 并让运行用户可写
#   3. 属主对齐（宿主 bind mount 可能由 root 或其它 uid 创建）
#   4. 缺 node_modules → 以运行用户安装一次
#   5. 降权到运行用户并 exec 主进程（PID 1 保持为 Koishi CLI）
set -eu

APP_DIR="${KOISHI_APP_DIR:-/app}"
SEED_DIR="${KOISHI_SEED_DIR:-/seed}"
RUN_USER="${KOISHI_RUN_USER:-bun}"

log() {
	printf '[entrypoint] %s\n' "$*" >&2
}

# 镜像内 bun 用户的 uid/gid 是 1000（与 Linux/WSL2 默认宿主用户一致），
# 以镜像为准动态读取，避免写死 uid 与镜像漂移
RUN_UID="$(id -u "$RUN_USER")"
RUN_GID="$(id -g "$RUN_USER")"

# 以 root 启动时降权到 bun；显式以非 root 启动（compose user:）时原样执行
run_as_user() {
	if [ "$(id -u)" -eq 0 ]; then
		gosu "$RUN_USER" "$@"
	else
		"$@"
	fi
}

install_deps() {
	if [ -f "$APP_DIR/bun.lock" ]; then
		run_as_user sh -c \
			'cd "$1" && bun install --frozen-lockfile --production' \
			sh "$APP_DIR"
	else
		log "bun.lock 不存在：退化为普通安装（建议提交 bun.lock 后重建镜像）"
		run_as_user sh -c \
			'cd "$1" && bun install --production' \
			sh "$APP_DIR"
	fi
}

# 非 root 启动（compose 显式 user:）：不做属主调整，初始化后直接启动
if [ "$(id -u)" -ne 0 ]; then
	if [ ! -f "$APP_DIR/package.json" ]; then
		cp -a "$SEED_DIR/." "$APP_DIR/"
	fi
	mkdir -p "$APP_DIR/data"
	[ -d "$APP_DIR/node_modules" ] || install_deps
	exec "$@"
fi

# 1) 空工作区：用镜像内置种子初始化
seeded=0
if [ ! -f "$APP_DIR/package.json" ]; then
	log "空工作区：从 $SEED_DIR 初始化"
	cp -a "$SEED_DIR/." "$APP_DIR/"
	seeded=1
fi

# 2) 数据目录必须存在（sqlite / assets-local 的落点）
mkdir -p "$APP_DIR/data"

# 3) 属主对齐：种子文件由 root 复制，宿主机目录也可能属于其它 uid。
#    Windows / macOS 的 bind mount 不支持 chown，失败时由 Docker Desktop
#    的映射层兜底，故显式忽略错误。
if [ "$seeded" -eq 1 ] || [ "$(stat -c '%u' "$APP_DIR")" != "$RUN_UID" ]; then
	log "对齐 $APP_DIR 属主为 $RUN_UID:$RUN_GID"
	chown -R "$RUN_UID:$RUN_GID" "$APP_DIR" 2>/dev/null || true
fi
chown "$RUN_UID:$RUN_GID" "$APP_DIR/data" 2>/dev/null || true

# 4) 依赖缺失：以运行用户补装一次（后续市场安装由 bun 自己增量处理）
if [ ! -d "$APP_DIR/node_modules" ]; then
	log "安装依赖"
	install_deps
fi

# 5) 降权启动；gosu 是 exec 语义，PID 1 即 Koishi CLI
exec gosu "$RUN_USER" "$@"
