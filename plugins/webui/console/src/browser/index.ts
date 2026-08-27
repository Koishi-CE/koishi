import { Console, type Entry } from "@koishi-ce/console";
import { makeArray, Schema } from "@koishi-ce/koishi";
import {} from "@koishi-ce/loader";

export * from "@koishi-ce/console";

class BrowserConsole extends Console {
	start() {
		this.accept(this.ctx.loader[Symbol.for("koishi.socket")]);
	}

	resolveEntry(files: Entry.Files) {
		if (typeof files === "string" || Array.isArray(files))
			return makeArray(files);
		return makeArray(files.prod);
	}
}

namespace BrowserConsole {
	export type Config = {};

	export const Config: Schema<Config> = Schema.object({});
}

export default BrowserConsole;
