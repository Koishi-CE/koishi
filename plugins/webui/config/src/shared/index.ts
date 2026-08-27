import type { PackageProvider } from "./packages";
import type { ServiceProvider } from "./services";
import type { ConfigWriter } from "./writer";

declare module "@koishi-ce/console" {
	namespace Console {
		interface Services {
			packages: PackageProvider;
			services: ServiceProvider;
			config: ConfigWriter;
		}
	}
}

export * from "./packages";
export * from "./services";
export * from "./writer";
