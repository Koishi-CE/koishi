import { Console, type Entry } from "@koishi-ce/console";
import { makeArray, Schema } from "@koishi-ce/koishi";
import {} from "@koishi-ce/loader";

export * from "@koishi-ce/console";

class BrowserConsole extends Console {
	// biome-ignore lint/style/useNamingConvention: 插件 Schema 约定为 PascalCase 的静态属性（与类型 namespace 同名合并）
	static Config: Schema<BrowserConsole.Config> = Schema.object({});

	override start() {
		// 浏览器宿主在 loader 上挂载的 socket 是运行时约定，仅以全局 symbol 注册表键存在，
		// 无法在 Loader 类型上声明（Symbol.for 的返回值不是 unique symbol，不能用作接口键）
		// @ts-expect-error koishi.socket symbol 索引不在 Loader 类型定义中
		this.accept(this.ctx.loader[Symbol.for("koishi.socket")]);
	}

	override resolveEntry(files: Entry.Files) {
		if (typeof files === "string" || Array.isArray(files))
			return makeArray(files);
		return makeArray(files.prod);
	}
}

// erasableSyntaxOnly 禁止含运行时值的 namespace：Config 常量改挂为类的静态属性
// （BrowserConsole.Config 的取值不变），namespace 仅保留类型声明以维持类型访问
namespace BrowserConsole {
	export type Config = {};
}

export default BrowserConsole;
