import * as shared from "../shared";

export class PackageProvider extends shared.PackageProvider {
	async collect(_forced: boolean) {
		return this.ctx.loader.market.objects;
	}
}
