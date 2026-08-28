/**
 * @file console DataService 通道的三个薄包装(console 域)。
 *
 * 模块职责:把 installer 侧的三个数据面(依赖快照/registry 全量缓存/
 * npm 端点状态)声明为 console 服务,前端经各自通道拉取。三个类都是
 * 只读透传:取数逻辑全部在 ctx.installer,这里只做服务注册与 authority 4
 * 权限约束,保持适配层"薄"。
 *
 * 架构位置:node 适配层 console 模块,由 setup.ts 实例化;服务键在
 * declarations.ts 中声明为 Console.Services。
 */
import { DataService } from "@koishi-ce/console";
import type { Context, Dict } from "@koishi-ce/koishi";
import type { DependencyMetaKey, RemotePackage } from "@koishi-ce/registry";
import type { Dependency } from "../../core/deps/types.js";
import type { RegistryStatus } from "../../shared/types.js";

/** dependencies 通道：依赖快照。 */
export class DependencyProvider extends DataService<Dict<Dependency>> {
	constructor(ctx: Context) {
		super(ctx, "dependencies", { authority: 4 });
	}

	override async get() {
		return (await this.ctx.installer.getDeps({ background: false })) ?? {};
	}
}

/** registry 通道：包版本元数据全量缓存。 */
export class RegistryProvider extends DataService<
	Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>
> {
	constructor(ctx: Context) {
		super(ctx, "registry", { authority: 4 });
	}

	override async get() {
		return this.ctx.installer.fullCache;
	}
}

/** registryStatus 通道：npm 端点状态。 */
export class RegistryStatusProvider extends DataService<Dict<RegistryStatus>> {
	constructor(ctx: Context) {
		super(ctx, "registryStatus", { authority: 4 });
	}

	override async get() {
		return this.ctx.installer.registryStatus;
	}
}
