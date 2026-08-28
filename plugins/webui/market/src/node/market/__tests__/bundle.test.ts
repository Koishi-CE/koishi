/**
 * bundle.ts 单测:removeBundleConfigs 全分支(找不到分组/只读/删成员/删空组/
 * 非 ~ 键的延迟 fullReload)+ installBundle 主链路(清单重解析校验失败、勾选
 * 合并、循环检测、安装失败不写配置、成功后写配置/记录/刷新)。
 *
 * 策略:loadManifest mock 掉(控制 beforeDeps 快照);registry/installer 全用
 * helpers mock;fullReload 延迟用 fake timers 推进。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadManifest } from "../../../core/registry/manifest.js";
import type {
    BundleInstallMember,
    BundleInstallRequest,
    PluginBundleRecord,
} from "../../../shared/bundle.js";
import { installBundle, removeBundleConfigs } from "../bundle.js";
import type { MarketDataStore } from "../data-store.js";
import { createMockContext, type MockContext } from "./helpers.js";

vi.mock("../../../core/registry/manifest.js", () => ({ loadManifest: vi.fn() }));

const loadManifestMock = vi.mocked(loadManifest);

/** 合包 fixture:koishi-plugin-pa-demo(分组键 group:pa-pa-demo)。 */
const PACKAGE = "koishi-plugin-pa-demo";
const GROUP_KEY = "group:pa-pa-demo";
const MEMBER: BundleInstallMember = {
    package: "koishi-plugin-foo",
    plugin: "foo",
    version: "^1.0.0",
    required: true,
    config: { greeting: "hi" },
    selected: true,
    createConfig: true,
    usePreset: false,
    move: false,
};

/** registry 元数据(versions[版本].koishi.bundle 形态)。 */
function registryWith(bundle: unknown, keywords = ["market:package"]) {
    return { versions: { "1.0.0": { keywords, koishi: { bundle } } } };
}

/** 标准请求:单成员勾选,可覆盖成员选项。 */
function requestOf(memberOverrides: Partial<BundleInstallMember> = {}): BundleInstallRequest {
    const members = [{ ...MEMBER, ...memberOverrides }];
    return {
        package: PACKAGE,
        version: "1.0.0",
        bundle: { label: "演示合包", members: [{ ...MEMBER, ...memberOverrides }] },
        members,
    };
}

/** 最小 dataStore 桩(只用到 setBundleRecord)。 */
function dataStoreStub() {
    return {
        setBundleRecord: vi.fn(async (record: PluginBundleRecord) => record),
    } as unknown as MarketDataStore & { setBundleRecord: ReturnType<typeof vi.fn> };
}

// loadManifest 是同步函数(真实实现走 readFileSync),mock 必须同步返回值
beforeEach(() => {
    loadManifestMock.mockReset().mockReturnValue({ dependencies: {} } as never);
});

describe("removeBundleConfigs", () => {
    it("按成员筛选删除配置并保留其他成员", async () => {
        const plugins = {
            "group:pa-demo-bundle": {
                "~foo:one": {},
                "~bar:two": {},
            },
        };
        const ctx = createMockContext({ plugins });

        const result = await removeBundleConfigs(ctx.asContext(), {
            package: "koishi-plugin-demo-bundle",
            members: [{ package: "koishi-plugin-foo", plugin: "foo" }],
            removeEmptyGroup: false,
        });

        expect(result.removed).toEqual(["~foo:one"]);
        expect(plugins["group:pa-demo-bundle"]).toMatchObject({ "~bar:two": {} });
        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
        expect(ctx.console.refresh).toHaveBeenCalledTimes(2);
    });

    it("删除最后成员时移除空 group", async () => {
        const plugins = { "group:pa-demo-bundle": { "~foo:one": {} } };
        const ctx = createMockContext({ plugins });

        const result = await removeBundleConfigs(ctx.asContext(), {
            package: "koishi-plugin-demo-bundle",
            removeEmptyGroup: true,
        });

        expect(result.removedGroup).toBe(true);
        expect(plugins).toEqual({});
    });

    it("不可写配置时不产生变更", async () => {
        const plugins = { "group:pa-demo-bundle": { "~foo:one": {} } };
        const ctx = createMockContext({ plugins, writable: false });

        const result = await removeBundleConfigs(ctx.asContext(), {
            package: "koishi-plugin-demo-bundle",
        });

        expect(result).toEqual({ groupKey: "group:pa-demo-bundle", removed: [] });
        expect(ctx.loader.writeConfig).not.toHaveBeenCalled();
    });

    it("找不到分组时返回空结果且不写盘不刷新", async () => {
        const ctx = createMockContext({ plugins: { other: {} } });

        const result = await removeBundleConfigs(ctx.asContext(), {
            package: "koishi-plugin-demo-bundle",
        });

        expect(result).toEqual({ groupKey: undefined, removed: [] });
        expect(ctx.loader.writeConfig).not.toHaveBeenCalled();
        expect(ctx.console.refresh).not.toHaveBeenCalled();
    });

    it("分组只剩 $ 元数据且 removeEmptyGroup=false 时不写盘", async () => {
        const plugins = { "group:pa-demo-bundle": { ["$label"]: "x", ["$collapsed"]: false } };
        const ctx = createMockContext({ plugins });

        const result = await removeBundleConfigs(ctx.asContext(), {
            package: "koishi-plugin-demo-bundle",
            removeEmptyGroup: false,
        });

        expect(result).toEqual({ groupKey: "group:pa-demo-bundle", removed: [] });
        expect(ctx.loader.writeConfig).not.toHaveBeenCalled();
    });

    describe("非 ~ 键删除触发延迟 fullReload", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it("删除运行中的插件键后 1s 触发 fullReload", async () => {
            const plugins = { "group:pa-demo-bundle": { "foo:one": {} } };
            const ctx = createMockContext({ plugins });

            await removeBundleConfigs(ctx.asContext(), {
                package: "koishi-plugin-demo-bundle",
                removeEmptyGroup: false,
            });
            expect(ctx.loader.fullReload).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1000);
            expect(ctx.loader.fullReload).toHaveBeenCalledTimes(1);
        });

        it("插件已停用(scope.isActive=false)时不 reload", async () => {
            const plugins = { "group:pa-demo-bundle": { "foo:one": {} } };
            const ctx = createMockContext({ plugins });
            ctx.scope.isActive = false;

            await removeBundleConfigs(ctx.asContext(), {
                package: "koishi-plugin-demo-bundle",
                removeEmptyGroup: false,
            });
            await vi.advanceTimersByTimeAsync(1000);

            expect(ctx.loader.fullReload).not.toHaveBeenCalled();
        });
    });
});

describe("installBundle", () => {
    let ctx: MockContext;
    let dataStore: MarketDataStore & { setBundleRecord: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        ctx = createMockContext();
        ctx.installer.getRegistry.mockResolvedValue(
            registryWith({ label: "演示合包", members: [{ ...MEMBER }] }) as never,
        );
        dataStore = dataStoreStub();
    });

    it("请求缺 version 时抛错", async () => {
        const request = requestOf();
        request.version = "";
        await expect(installBundle(ctx.asContext(), dataStore, request)).rejects.toThrow(
            "bundle package version is required",
        );
        expect(ctx.installer.install).not.toHaveBeenCalled();
    });

    it("registry 元数据未加载时抛错", async () => {
        ctx.installer.getRegistry.mockResolvedValue({} as never);

        await expect(installBundle(ctx.asContext(), dataStore, requestOf())).rejects.toThrow(
            `bundle package metadata not loaded: ${PACKAGE}`,
        );
    });

    it("请求版本在 registry 中不存在时抛错", async () => {
        ctx.installer.getRegistry.mockResolvedValue(registryWith(undefined, undefined) as never);
        ctx.installer.getRegistry.mockResolvedValue({
            versions: { "0.9.0": { keywords: ["market:package"] } },
        } as never);

        await expect(installBundle(ctx.asContext(), dataStore, requestOf())).rejects.toThrow(
            `bundle package version not found: ${PACKAGE}@1.0.0`,
        );
    });

    it("远端清单缺失 koishi.bundle 时校验失败抛错", async () => {
        ctx.installer.getRegistry.mockResolvedValue({
            versions: { "1.0.0": { keywords: ["market:package"] } },
        } as never);

        await expect(installBundle(ctx.asContext(), dataStore, requestOf())).rejects.toThrow(
            /invalid plugin bundle: .*missing koishi\.bundle/,
        );
    });

    it("没有勾选成员时抛错", async () => {
        await expect(
            installBundle(ctx.asContext(), dataStore, requestOf({ selected: false })),
        ).rejects.toThrow("plugin bundle has no selected members");
    });

    it("成员清单指回合包自身(直接循环)时抛错", async () => {
        ctx.installer.getRegistry.mockImplementation(async (name: string) => {
            if (name === PACKAGE)
                return registryWith({ label: "演示合包", members: [{ ...MEMBER }] }) as never;
            return {
                versions: {
                    "1.2.0": {
                        koishi: {
                            bundle: {
                                label: "反指",
                                members: [{ package: PACKAGE, plugin: "demo", version: "*" }],
                            },
                        },
                    },
                },
            } as never;
        });

        await expect(installBundle(ctx.asContext(), dataStore, requestOf())).rejects.toThrow(
            `plugin bundle has a direct cycle: ${PACKAGE} <-> koishi-plugin-foo`,
        );
        expect(ctx.installer.install).not.toHaveBeenCalled();
    });

    it("成员 registry 拉取失败只记 debug 不阻断安装", async () => {
        ctx.installer.getRegistry.mockImplementation(async (name: string) => {
            if (name === PACKAGE)
                return registryWith({ label: "演示合包", members: [{ ...MEMBER }] }) as never;
            throw new Error("registry down");
        });

        const result = await installBundle(ctx.asContext(), dataStore, requestOf());

        expect(result.code).toBe(0);
        expect(ctx.log.debug).toHaveBeenCalledWith(
            expect.stringContaining("plugin bundle cycle check skipped"),
        );
    });

    it("成员版本无满足项时跳过循环检查继续安装", async () => {
        ctx.installer.getRegistry.mockImplementation(async (name: string) => {
            if (name === PACKAGE)
                return registryWith({ label: "演示合包", members: [{ ...MEMBER }] }) as never;
            return { versions: {} } as never;
        });

        const result = await installBundle(ctx.asContext(), dataStore, requestOf());
        expect(result.code).toBe(0);
    });

    it("安装器返回非 0:不写配置不产记录,但仍刷新通道", async () => {
        ctx.installer.install.mockResolvedValue(1);

        const result = await installBundle(ctx.asContext(), dataStore, requestOf());

        expect(result.code).toBe(1);
        expect(result.record).toBeUndefined();
        expect(ctx.loader.config.plugins[GROUP_KEY]).toBeUndefined();
        expect(dataStore.setBundleRecord).not.toHaveBeenCalled();
        expect(ctx.console.refresh).toHaveBeenCalledTimes(4);
        expect(ctx.console.refresh).toHaveBeenNthCalledWith(1, "dependencies");
    });

    it("成功主链路:安装 override+写配置+记录+刷新", async () => {
        loadManifestMock.mockReturnValue({ dependencies: {} } as never);

        const result = await installBundle(ctx.asContext(), dataStore, requestOf());

        // 安装参数:合包自身 + 勾选成员的精确版本请求,未 forced,空选项
        expect(ctx.installer.install).toHaveBeenCalledWith(
            { [PACKAGE]: "1.0.0", "koishi-plugin-foo": "^1.0.0" },
            undefined,
            expect.any(Function),
            {},
        );
        // 配置分组落位(成员未勾 usePreset → 空配置)
        const group = ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>;
        expect(group["$label"]).toBe("演示合包");
        expect(group["~foo:pa-pa-demo-foo"]).toEqual({});
        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
        // 记录:beforeDeps 为空 → installedByBundle true
        expect(result.record).toMatchObject({
            package: PACKAGE,
            version: "1.0.0",
            groupKey: GROUP_KEY,
            members: [
                expect.objectContaining({
                    package: "koishi-plugin-foo",
                    installedByBundle: true,
                    configured: true,
                    selected: true,
                }),
            ],
        });
        expect(dataStore.setBundleRecord).toHaveBeenCalledWith(result.record);
        expect(result.installed).toEqual([PACKAGE, "koishi-plugin-foo"]);
        expect(result.groupKey).toBe(GROUP_KEY);
    });

    it("beforeDeps 已有成员依赖时 installedByBundle 为 false", async () => {
        loadManifestMock.mockReturnValue({
            dependencies: { "koishi-plugin-foo": "^1.0.0" },
        } as never);

        const result = await installBundle(ctx.asContext(), dataStore, requestOf());

        expect(result.record?.members[0]).toMatchObject({ installedByBundle: false });
    });

    it("usePreset 成员写入清单预置配置且记录 usePreset", async () => {
        const result = await installBundle(
            ctx.asContext(),
            dataStore,
            requestOf({ usePreset: true }),
        );

        const group = ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>;
        expect(group["~foo:pa-pa-demo-foo"]).toEqual({ greeting: "hi" });
        expect(result.record?.members[0]).toMatchObject({ usePreset: true });
    });

    it("forced 与 options 透传给安装器", async () => {
        const options = { target: "cwd" } as never;

        await installBundle(ctx.asContext(), dataStore, requestOf(), true, options);

        expect(ctx.installer.install).toHaveBeenCalledWith(
            expect.anything(),
            true,
            expect.any(Function),
            options,
        );
    });

    it("writer.write 幂等:安装器完成回调和显式调用只写一轮配置", async () => {
        ctx.installer.install.mockImplementation(
            async (_deps: unknown, _forced: unknown, onFinish: () => Promise<void>) => {
                await onFinish();
                return 0;
            },
        );

        await installBundle(ctx.asContext(), dataStore, requestOf());

        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
    });
});
