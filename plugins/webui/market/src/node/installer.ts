import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {} from "@koishi-ce/console";
import {
	type Context,
	type Dict,
	defineProperty,
	type HTTP,
	Logger,
	pick,
	Schema,
	Service,
	Time,
	valueMap,
} from "@koishi-ce/koishi";
import type {} from "@koishi-ce/loader";
import Scanner, {
	type DependencyMetaKey,
	type PackageJson,
	type Registry,
	type RemotePackage,
} from "@koishi-ce/registry";
import spawn from "execa";
import getRegistry from "get-registry";
import pMap from "p-map";
import { compare, satisfies, valid } from "semver";
import which from "which-pm-runs";
import type {} from ".";

const logger = new Logger("market");

export interface Dependency {
	/**
	 * requested semver range
	 * @example `^1.2.3` -> `1.2.3`
	 */
	request: string;
	/**
	 * installed package version
	 * @example `1.2.5`
	 */
	resolved?: string | undefined;
	/** whether it is a workspace package */
	workspace?: boolean | undefined;
	/** valid (unsupported) syntax */
	invalid?: boolean | undefined;
	/** latest version */
	latest?: string | undefined;
}

export interface YarnLog {
	type: "warning" | "info" | "error" | string;
	name: number | null;
	displayName: string;
	indent?: string;
	data: string;
}

const levelMap = {
	info: "info",
	warning: "debug",
	error: "warn",
} as const;

export interface LocalPackage extends PackageJson {
	private?: boolean;
	$workspace?: boolean;
	/** loadManifest 归一化保证 dependencies 必有 */
	dependencies: Record<string, string>;
}

export function loadManifest(name: string) {
	const filename = require.resolve(`${name}/package.json`);
	const meta: LocalPackage = JSON.parse(readFileSync(filename, "utf8"));
	meta.dependencies ||= {};
	defineProperty(meta, "$workspace", !filename.includes("node_modules"));
	return meta;
}

function getVersions(versions: RemotePackage[]) {
	return Object.fromEntries(
		versions
			.map(
				(item) =>
					[
						item.version,
						pick(item, [
							"peerDependencies",
							"peerDependenciesMeta",
							"deprecated",
						]),
					] as const,
			)
			.sort(([a], [b]) => compare(b, a)),
	);
}

class Installer extends Service {
	declare http: HTTP;
	declare endpoint: string | undefined;
	public fullCache: Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>> = {};
	public tempCache: Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>> = {};

	private pkgTasks: Dict<
		Promise<Dict<Pick<RemotePackage, DependencyMetaKey>>>
	> = {};
	private agent = which();
	private manifest: LocalPackage;
	private declare depTask: Promise<Dict<Dependency>>;
	private flushData: () => void;

	override config: Installer.Config;

	constructor(ctx: Context, config: Installer.Config) {
		super(ctx, "installer");
		this.config = config;
		this.manifest = loadManifest(this.cwd);
		this.flushData = ctx.throttle(() => {
			ctx.get("console")?.broadcast("market/registry", this.tempCache);
			this.tempCache = {};
		}, 500);
	}

	get cwd() {
		return this.ctx.baseDir;
	}

	override async start() {
		const { endpoint, timeout } = this.config;
		this.endpoint = endpoint ?? (await getRegistry());
		const options: HTTP.Config = {};
		if (this.endpoint) options.endpoint = this.endpoint;
		if (timeout !== undefined) options.timeout = timeout;
		this.http = this.ctx.http.extend(options);
	}

	resolveName(name: string) {
		if (name.startsWith("@koishijs/plugin-")) return [name];
		if (name.match(/(^|\/)koishi-plugin-/)) return [name];
		if (name[0] === "@") {
			const [left, right] = name.split("/");
			return [`${left}/koishi-plugin-${right}`];
		} else {
			return [`@koishijs/plugin-${name}`, `koishi-plugin-${name}`];
		}
	}

	async findVersion(names: string[]) {
		const entries = await Promise.all(
			names.map(async (name) => {
				try {
					const versions = Object.entries(await this.getPackage(name));
					const [latest] = versions;
					if (!latest) return undefined;
					return { [name]: latest[0] };
				} catch {
					return undefined;
				}
			}),
		);
		return entries.find((entry): entry is Dict<string> => entry !== undefined);
	}

	private async _getPackage(name: string) {
		try {
			const registry = await this.http.get<Registry>(`/${name}`);
			const versions = getVersions(
				Object.values(registry.versions).filter((remote) => {
					if (name === "koishi") return satisfies(remote.version, "4");
					return !Scanner.isPlugin(name) || Scanner.isCompatible("4", remote);
				}),
			);
			this.fullCache[name] = this.tempCache[name] = versions;
			this.flushData();
			return versions;
		} catch (error) {
			logger.warn(error);
			return {};
		}
	}

	setPackage(name: string, versions: RemotePackage[]) {
		this.fullCache[name] = this.tempCache[name] = getVersions(versions);
		this.flushData();
		this.pkgTasks[name] = Promise.resolve(this.fullCache[name]);
	}

	getPackage(name: string) {
		return (this.pkgTasks[name] ||= this._getPackage(name));
	}

	private async _getDeps() {
		const result = valueMap(this.manifest.dependencies, (request) => {
			return { request: request.replace(/^[~^]/, "") } as Dependency;
		});
		await pMap(
			Object.keys(result),
			async (name) => {
				const dep = result[name];
				if (!dep) return;
				try {
					// some dependencies may be left with no local installation
					const meta = loadManifest(name);
					dep.resolved = meta.version;
					dep.workspace = meta.$workspace;
					if (meta.$workspace) return;
				} catch {}

				if (!valid(dep.request)) {
					dep.invalid = true;
				}

				const versions = await this.getPackage(name);
				if (versions) dep.latest = Object.keys(versions)[0];
			},
			{ concurrency: 10 },
		);
		return result;
	}

	getDeps() {
		return (this.depTask ||= this._getDeps());
	}

	refreshData() {
		this.ctx.get("console")?.refresh("registry");
		this.ctx.get("console")?.refresh("packages");
	}

	refresh(refresh = false) {
		this.pkgTasks = {};
		this.fullCache = {};
		this.tempCache = {};
		this.depTask = this._getDeps();
		if (!refresh) return;
		this.refreshData();
	}

	async exec(args: string[]) {
		const name = this.agent?.name ?? "npm";
		const useJson = name === "yarn" && (this.agent?.version ?? "1") >= "2";
		if (name !== "yarn") args.unshift("install");
		return new Promise<number>((resolve) => {
			if (useJson) args.push("--json");
			const child = spawn(name, args, { cwd: this.cwd });
			child.on("exit", (code) => resolve(code ?? -1));
			child.on("error", () => resolve(-1));

			let stderr = "";
			child.stderr?.on("data", (data) => {
				data = stderr + data.toString();
				const lines = data.split("\n");
				stderr = lines.pop() ?? "";
				for (const line of lines) {
					logger.warn(line);
				}
			});

			let stdout = "";
			child.stdout?.on("data", (data) => {
				data = stdout + data.toString();
				const lines = data.split("\n");
				stdout = lines.pop() ?? "";
				for (const line of lines) {
					if (!useJson || line[0] !== "{") {
						logger.info(line);
						continue;
					}
					try {
						const { type, data } = JSON.parse(line) as YarnLog;
						const level =
							type in levelMap ? levelMap[type as keyof typeof levelMap] : null;
						(level ? logger[level] : logger.info)(data);
					} catch (error) {
						logger.warn(line);
						logger.warn(error);
					}
				}
			});
		});
	}

	async override(deps: Dict<string | null>) {
		const filename = resolve(this.cwd, "package.json");
		for (const key in deps) {
			if (deps[key]) {
				this.manifest.dependencies[key] = deps[key];
			} else {
				delete this.manifest.dependencies[key];
			}
		}
		this.manifest.dependencies = Object.fromEntries(
			Object.entries(this.manifest.dependencies).sort((a, b) =>
				a[0].localeCompare(b[0]),
			),
		);
		await Bun.write(filename, `${JSON.stringify(this.manifest, null, 2)}\n`);
	}

	private _install() {
		const args: string[] = [];
		if (this.endpoint) {
			args.push("--registry", this.endpoint);
		}
		return this.exec(args);
	}

	private _getLocalDeps(override: Dict<string | null>) {
		return valueMap(override, (request, name) => {
			const dep = { request } as Dependency;
			try {
				const meta = loadManifest(name);
				dep.resolved = meta.version;
				dep.workspace = meta.$workspace;
			} catch {}
			return dep;
		});
	}

	async install(deps: Dict<string | null>, forced?: boolean) {
		const localDeps = this._getLocalDeps(deps);
		await this.override(deps);

		let shouldInstall = forced === true;
		for (const name in deps) {
			const request = deps[name];
			const local = localDeps[name];
			if (
				local?.workspace ||
				(request &&
					local?.resolved &&
					satisfies(local.resolved, request, { includePrerelease: true }))
			)
				continue;
			shouldInstall = true;
			break;
		}

		if (shouldInstall) {
			const code = await this._install();
			if (code) return code;
		}

		this.refresh();
		const newDeps = await this.getDeps();
		for (const name in localDeps) {
			const local = localDeps[name];
			const newDep = newDeps[name];
			if (!local || !newDep || local.workspace) continue;
			if (newDep.resolved === local.resolved) continue;
			try {
				if (!(require.resolve(name) in require.cache)) continue;
			} catch (error) {
				// FIXME https://github.com/koishijs/webui/issues/273
				// I have no idea why this happens and how to fix it.
				logger.error(error);
			}
			this.ctx.loader.fullReload();
		}
		this.refreshData();

		return 0;
	}

	// erasableSyntaxOnly 禁止含运行时值的 namespace，
	// 原 namespace 内的 Config 常量移到此处的静态字段，对外形状不变
	static Config: Schema<Installer.Config> = Schema.object({
		endpoint: Schema.string().role("link"),
		timeout: Schema.number()
			.role("time")
			.default(Time.second * 5),
	}); // TODO .hidden()
}

declare namespace Installer {
	export interface Config {
		endpoint?: string;
		timeout?: number;
	}
}

export default Installer;
