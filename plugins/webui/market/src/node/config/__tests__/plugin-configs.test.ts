import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../core/registry/manifest.js", () => ({
    loadManifest: vi.fn(),
    // isPlugin 用与 shared/bundle.ts 一致的包名正则,避免加载真实 registry
    // biome-ignore lint/style/useNamingConvention: 键名须与被 mock 模块的导出名一致
    Scanner: {
        isPlugin: (name: string) =>
            /^(?:@[^/]+\/)?koishi-plugin-[0-9a-z-]+$|^@koishijs\/plugin-[0-9a-z-]+$/.test(name),
    },
}));
vi.mock("../../../core/utils/async.js", () => ({ sleep: vi.fn(async () => {}) }));
vi.mock("../../console/refresh.js", () => ({ refreshConsole: vi.fn(async () => {}) }));
vi.mock("../../installer/index.js", () => ({ SELF_PACKAGE: "@koishi-ce/plugin-marketn" }));

import { loadManifest, Scanner } from "../../../core/registry/manifest.js";
import { sleep } from "../../../core/utils/async.js";
import { refreshConsole } from "../../console/refresh.js";
import { SELF_PACKAGE } from "../../installer/index.js";
import {
    ensureInstalledPluginConfigs,
    ensurePluginConfig,
    ensurePluginConfigs,
} from "../plugin-configs.js";

type Manifests = Record<string, Record<string, unknown>>;

function makeContext(plugins: Record<string, unknown>, options?: { writable?: boolean }) {
    const writeConfig = vi.fn(async () => {});
    const runtimeListener = vi.fn(async () => {});
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    return {
        baseDir: "/host",
        loader: { config: { plugins }, writable: options?.writable ?? true, writeConfig },
        scope: { isActive: true },
        logger: vi.fn(() => logger),
        get: (name: string) =>
            name === "console"
                ? { listeners: { "config/request-runtime": { callback: runtimeListener } } }
                : undefined,
        // 测试内部可触达的桩,便于断言
        writeConfig,
        runtimeListener,
        loggerInstance: logger,
    };
}

let manifests: Manifests;

beforeEach(() => {
    vi.clearAllMocks();
    manifests = {};
    vi.mocked(loadManifest).mockImplementation(((...args: unknown[]) => {
        const [target] = args as [string];
        const manifest = manifests[target];
        if (!manifest) throw Object.assign(new Error("MODULE_NOT_FOUND"), { code: "ENOENT" });
        return manifest;
    }) as never);
});

describe("ensurePluginConfig", () => {
    it("非插件包名直接跳过", async () => {
        const ctx = makeContext({});
        expect(await ensurePluginConfig(ctx as never, "not-a-plugin")).toBe(false);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
    });

    it("本插件自身跳过", async () => {
        const ctx = makeContext({});
        expect(await ensurePluginConfig(ctx as never, SELF_PACKAGE)).toBe(false);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
    });

    it("合包命名命中即跳过（不读 manifest）", async () => {
        const ctx = makeContext({});
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-pa-demo")).toBe(false);
        expect(loadManifest).not.toHaveBeenCalled();
        expect(ctx.loggerInstance.debug).toHaveBeenCalled();
    });

    it("manifest 带 koishi.bundle 清单视为合包跳过", async () => {
        manifests["koishi-plugin-bundled"] = {
            koishi: {
                bundle: { members: [{ package: "koishi-plugin-member", plugin: "member" }] },
            },
        };
        const ctx = makeContext({});
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-bundled")).toBe(false);
    });

    it("manifest 关键字含 market:package 视为合包跳过", async () => {
        manifests["koishi-plugin-with-keyword"] = { keywords: ["MARKET:PACKAGE"] };
        const ctx = makeContext({});
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-with-keyword")).toBe(false);
    });

    it("manifest 读取失败按非合包继续，走手写禁用条目兜底", async () => {
        const ctx = makeContext({});
        // 无 manifest、无 runtime listener 写入：兜底创建 ~demo:<ident> 并写盘
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-demo")).toBe(true);
        const keys = Object.keys(ctx.loader.config.plugins);
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatch(/^~demo:[0-9a-z]{1,6}$/);
        expect(ctx.writeConfig).toHaveBeenCalledTimes(1);
        expect(ctx.loggerInstance.info).toHaveBeenCalled();
    });

    it("配置树已有条目（含 group 嵌套）时不重复创建", async () => {
        const flat = makeContext({ "~demo:x": {} });
        expect(await ensurePluginConfig(flat as never, "koishi-plugin-demo")).toBe(false);
        const nested = makeContext({ "group:g": { "demo:y": {} } });
        expect(await ensurePluginConfig(nested as never, "koishi-plugin-demo")).toBe(false);
        expect(flat.writeConfig).not.toHaveBeenCalled();
        expect(flat.runtimeListener).not.toHaveBeenCalled();
    });

    it("runtime listener 补建成功后不再手写", async () => {
        const ctx = makeContext({});
        ctx.runtimeListener.mockImplementation(async () => {
            ctx.loader.config.plugins["demo:runtime"] = {};
        });
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-demo")).toBe(false);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
    });

    it("runtime listener 抛错仅告警，仍走手写兜底", async () => {
        const ctx = makeContext({});
        ctx.runtimeListener.mockRejectedValue(new Error("boom"));
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-demo")).toBe(true);
        expect(ctx.loggerInstance.warn).toHaveBeenCalled();
    });

    it("loader 只读（writable=false）时放弃创建", async () => {
        const ctx = makeContext({}, { writable: false });
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-demo")).toBe(false);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
    });

    it("plugins 配置缺失时放弃创建", async () => {
        const ctx = makeContext(undefined as never);
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-demo")).toBe(false);
    });

    it("write=false 时创建条目但不写盘", async () => {
        const ctx = makeContext({});
        expect(await ensurePluginConfig(ctx as never, "koishi-plugin-demo", false)).toBe(true);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
    });
});

describe("ensurePluginConfigs", () => {
    it("过滤非插件名且全部已有配置时返回 false（不写盘不刷新）", async () => {
        const ctx = makeContext({ "~demo:a": {} });
        expect(
            await ensurePluginConfigs(ctx as never, ["not-a-plugin", "koishi-plugin-demo"]),
        ).toBe(false);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
        expect(refreshConsole).not.toHaveBeenCalled();
    });

    it("有新建条目时统一写盘并刷新 config/packages 通道", async () => {
        const ctx = makeContext({});
        expect(await ensurePluginConfigs(ctx as never, ["koishi-plugin-demo"])).toBe(true);
        expect(ctx.writeConfig).toHaveBeenCalledTimes(1);
        expect(refreshConsole).toHaveBeenCalledWith(ctx as never, ["config", "packages"]);
    });

    it("scope 失活时立即中断返回 false", async () => {
        const ctx = makeContext({});
        ctx.scope.isActive = false;
        expect(await ensurePluginConfigs(ctx as never, ["koishi-plugin-demo"])).toBe(false);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
    });

    it("每检查 20 个插件让出一次事件循环", async () => {
        const ctx = makeContext({});
        const names = Array.from({ length: 21 }, (_, i) => `koishi-plugin-m${i}`);
        await ensurePluginConfigs(ctx as never, names);
        expect(Scanner.isPlugin("koishi-plugin-m0")).toBe(true);
        expect(sleep).toHaveBeenCalledTimes(1);
    });
});

describe("ensureInstalledPluginConfigs", () => {
    it("对照宿主依赖扫描：无缺失时返回 false", async () => {
        manifests["/host"] = {
            dependencies: {
                "koishi-plugin-demo": "1.0.0",
                "not-a-plugin": "1.0.0",
            },
        };
        manifests["koishi-plugin-demo"] = {};
        const ctx = makeContext({ "~demo:x": {} });
        expect(await ensureInstalledPluginConfigs(ctx as never)).toBe(false);
        expect(ctx.writeConfig).not.toHaveBeenCalled();
    });

    it("合包依赖与已配置依赖不参与补建", async () => {
        manifests["/host"] = {
            dependencies: {
                "koishi-plugin-pa-demo": "1.0.0",
                "koishi-plugin-demo": "1.0.0",
            },
        };
        manifests["koishi-plugin-pa-demo"] = {};
        const ctx = makeContext({ "demo:x": {} });
        expect(await ensureInstalledPluginConfigs(ctx as never)).toBe(false);
    });

    it("发现缺失插件时补建条目并写盘", async () => {
        manifests["/host"] = {
            dependencies: { "koishi-plugin-demo": "1.0.0" },
        };
        const ctx = makeContext({});
        expect(await ensureInstalledPluginConfigs(ctx as never)).toBe(true);
        expect(Object.keys(ctx.loader.config.plugins)[0]).toMatch(/^~demo:/);
        expect(ctx.writeConfig).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalled();
    });
});
