import * as shared from "../shared/index.ts";

export class PackageProvider extends shared.PackageProvider {
	async collect(_forced: boolean) {
		return this.ctx.loader.market.objects;
	}
}
