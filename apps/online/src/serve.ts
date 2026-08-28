/**
 * 构建产物的本地预览服务器：把 apps/online/dist 以 SPA 方式伺服在
 * 3000 端口，用于在本地验证生产构建的效果；线上部署配置见同目录的
 * vercel.json。
 */
import Router from "@koa/router";
import { createReadStream, existsSync } from "fs";
import Koa from "koa";
import { extname, resolve } from "path";

const app = new Koa();
const router = new Router();

app.use(router.routes());
app.use(router.allowedMethods());

// dist 即 vite 产物根目录（见 src/build.ts）
const root = resolve(
	require.resolve("@koishi-ce/online/package.json"),
	"../dist",
);

// SPA 静态路由：命中磁盘文件则原样返回；目录路径或不存在的资源一律
// 回退到 index.html，由前端路由接管
router.get("(/.+)*", async (ctx, next) => {
	let filename = root + ctx.path;
	if (ctx.path.endsWith("/") || !existsSync(root + ctx.path)) {
		filename = root + "/index.html";
	}
	ctx.type = extname(filename);
	ctx.body = createReadStream(filename);
	return next();
});

app.listen(3000);
