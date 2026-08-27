import Router from "@koa/router";
import { createReadStream, existsSync } from "fs";
import Koa from "koa";
import { extname, resolve } from "path";

const app = new Koa();
const router = new Router();

app.use(router.routes());
app.use(router.allowedMethods());

const root = resolve(
	require.resolve("@koishi-ce/online/package.json"),
	"../dist",
);

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
