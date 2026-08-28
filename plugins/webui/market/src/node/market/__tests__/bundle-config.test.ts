/**
 * bundle-config.ts 单测:getBundleGroup 读取 + createBundleConfigWriter 的
 * 分组建组/补元数据/成员四策略(createConfig 跳过、组内已有跳过、组外搬移、
 * 新建 ~短名:标识 键)/write 幂等/无变更不写盘。
 *
 * 约定 fixture:合包 koishi-plugin-demo-bundle(分组键 group:pa-demo-bundle,
 * 成员标识 pa-demo-bundle-短名),成员短名按 getPluginShortname 派生。
 */
import { describe, expect, it } from "vitest";
import type {
    BundleInstallMember,
    BundleInstallRequest,
    PluginBundleManifest,
} from "../../../shared/bundle.js";
import { createBundleConfigWriter, getBundleGroup } from "../bundle-config.js";
import { createMockContext, type MockContext } from "./helpers.js";

const PACKAGE = "koishi-plugin-demo-bundle";
const GROUP_KEY = "group:pa-demo-bundle";

/** 成员 manifest 模板(包名必须符合 koishi-plugin-* 命名)。 */
function member(overrides: Partial<BundleInstallMember> = {}): BundleInstallMember {
    return {
        package: "koishi-plugin-foo",
        plugin: "foo",
        version: "^1.0.0",
        selected: true,
        createConfig: true,
        usePreset: false,
        ...overrides,
    };
}

function manifestOf(members: BundleInstallMember[], label?: string): PluginBundleManifest {
    return {
        label,
        members: members.map(({ package: pkg, plugin, version, config, required }) => ({
            package: pkg,
            plugin,
            version,
            config,
            required,
        })),
    };
}

function requestOf(members: BundleInstallMember[]): BundleInstallRequest {
    return { package: PACKAGE, version: "1.0.0", bundle: manifestOf(members), members };
}

describe("getBundleGroup", () => {
    it("命中已配置的合包分组", () => {
        const group = { "~foo:pa-demo-bundle-foo": { a: 1 } };
        const ctx = createMockContext({ plugins: { [GROUP_KEY]: group } });

        const result = getBundleGroup(ctx.asContext(), PACKAGE);

        expect(result).toEqual({ key: GROUP_KEY, plugins: group });
    });

    it("未配置该分组时返回 undefined", () => {
        const ctx = createMockContext({ plugins: { other: {} } });
        expect(getBundleGroup(ctx.asContext(), PACKAGE)).toBeUndefined();
    });

    it("loader 无 plugins 配置时返回 undefined", () => {
        const ctx: MockContext = createMockContext();
        ctx.loader.config = {} as never;
        expect(getBundleGroup(ctx.asContext(), PACKAGE)).toBeUndefined();
    });
});

describe("createBundleConfigWriter", () => {
    it("新建分组:补 $label(清单 label)/$collapsed,成员按 usePreset 写预置配置", async () => {
        const members = [
            member({ usePreset: true, config: { greeting: "hi" } }),
            member({ package: "koishi-plugin-bar", plugin: "bar", config: { x: 9 } }),
        ];
        const ctx = createMockContext();
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示合包"),
            members,
        );

        await writer.write();

        const group = ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>;
        expect(group["$label"]).toBe("演示合包");
        expect(group["$collapsed"]).toBe(false);
        expect(group["~foo:pa-demo-bundle-foo"]).toEqual({ greeting: "hi" });
        expect(group["~bar:pa-demo-bundle-bar"]).toEqual({});
        expect(writer.group?.key).toBe(GROUP_KEY);
        expect(writer.configured).toEqual(["koishi-plugin-foo", "koishi-plugin-bar"]);
        expect(writer.moved).toEqual([]);
        expect(writer.skipped).toEqual([]);
        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
    });

    it("清单无 label 时 $label 回退包短名", async () => {
        const members = [member()];
        const ctx = createMockContext();
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members),
            members,
        );

        await writer.write();

        expect((ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>)["$label"]).toBe(
            "demo-bundle",
        );
    });

    it("既有分组缺 $label/$collapsed 时补写元数据", async () => {
        const members = [member()];
        const ctx = createMockContext({ plugins: { [GROUP_KEY]: {} } });
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "补元数据"),
            members,
        );

        await writer.write();

        const group = ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>;
        expect(group["$label"]).toBe("补元数据");
        expect(group["$collapsed"]).toBe(false);
        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
    });

    it("createConfig=false 的成员跳过且不写配置", async () => {
        const members = [member({ createConfig: false })];
        const ctx = createMockContext();
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        expect(writer.skipped).toEqual(["koishi-plugin-foo"]);
        expect(writer.configured).toEqual([]);
        // 分组元数据仍会建好($label/$collapsed 本身算变更,触发一次写盘)
        const group = ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>;
        expect(group["$label"]).toBe("演示");
        expect(group["$collapsed"]).toBe(false);
        expect(Object.keys(group).filter((key) => !key.startsWith("$"))).toEqual([]);
        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
    });

    it("组内已有同短名配置时跳过,不覆盖既有配置", async () => {
        const members = [member()];
        const ctx = createMockContext({
            plugins: {
                [GROUP_KEY]: {
                    ["$label"]: "演示",
                    ["$collapsed"]: false,
                    "foo:custom": { existing: true },
                },
            },
        });
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        expect(writer.configured).toEqual([]);
        expect(writer.skipped).toEqual([]);
        expect(
            (ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>)["foo:custom"],
        ).toEqual({ existing: true });
        expect(ctx.loader.writeConfig).not.toHaveBeenCalled();
    });

    it("组外同短名且勾选 move:保留原键搬移进分组并从组外删除", async () => {
        const members = [member({ move: true })];
        const ctx = createMockContext({
            plugins: {
                "foo:custom": { existing: true },
                [GROUP_KEY]: { ["$label"]: "演示", ["$collapsed"]: false },
            },
        });
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        expect(writer.moved).toEqual(["koishi-plugin-foo"]);
        expect(ctx.loader.config.plugins["foo:custom"]).toBeUndefined();
        expect(
            (ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>)["foo:custom"],
        ).toEqual({ existing: true });
        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
    });

    it("组外同短名但未勾 move:不搬移,直接新建合成键", async () => {
        const members = [member({ move: false })];
        const ctx = createMockContext({
            plugins: {
                "foo:custom": { existing: true },
                [GROUP_KEY]: { ["$label"]: "演示", ["$collapsed"]: false },
            },
        });
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        expect(writer.moved).toEqual([]);
        expect(writer.configured).toEqual(["koishi-plugin-foo"]);
        expect(ctx.loader.config.plugins["foo:custom"]).toEqual({ existing: true });
        expect(
            (ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>)[
                "~foo:pa-demo-bundle-foo"
            ],
        ).toEqual({});
    });

    it("组外同短名藏在嵌套 group 里且勾 move:递归找到并搬移", async () => {
        const members = [member({ move: true })];
        const ctx = createMockContext({
            plugins: {
                "group:other": { "foo:deep": { deep: true } },
                [GROUP_KEY]: { ["$label"]: "演示", ["$collapsed"]: false },
            },
        });
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        expect(writer.moved).toEqual(["koishi-plugin-foo"]);
        expect(
            (ctx.loader.config.plugins["group:other"] as Record<string, unknown>)["foo:deep"],
        ).toBeUndefined();
        expect(
            (ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>)["foo:deep"],
        ).toEqual({
            deep: true,
        });
    });

    it("只读且没有既有分组:ensure 失败回退 getBundleGroup 也拿不到,成员记跳过", async () => {
        const members = [member()];
        const ctx = createMockContext({ writable: false });
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        expect(writer.group).toBeUndefined();
        expect(writer.skipped).toEqual(["koishi-plugin-foo"]);
        expect(ctx.loader.writeConfig).not.toHaveBeenCalled();
    });

    it("只读但已有分组:仍会在内存里配置成员并调用 writeConfig(源码行为)", async () => {
        const members = [member()];
        const ctx = createMockContext({
            writable: false,
            plugins: { [GROUP_KEY]: { ["$label"]: "演示", ["$collapsed"]: false } },
        });
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        expect(writer.group?.key).toBe(GROUP_KEY);
        expect(writer.configured).toEqual(["koishi-plugin-foo"]);
        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
    });

    it("write 幂等:二次调用不再写盘、结果不重复累计", async () => {
        const members = [member()];
        const ctx = createMockContext();
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();
        await writer.write();

        expect(ctx.loader.writeConfig).toHaveBeenCalledTimes(1);
        expect(writer.configured).toEqual(["koishi-plugin-foo"]);
    });

    it("成员 plugin 缺省时短名回退包名派生", async () => {
        const members = [member({ package: "koishi-plugin-baz", plugin: "" })];
        const ctx = createMockContext();
        const writer = createBundleConfigWriter(
            ctx.asContext(),
            requestOf(members),
            manifestOf(members, "演示"),
            members,
        );

        await writer.write();

        const group = ctx.loader.config.plugins[GROUP_KEY] as Record<string, unknown>;
        expect(group["~baz:pa-demo-bundle-baz"]).toEqual({});
    });

    describe("属性可枚举性边界(组探测用 for...in,键占用判定用 in)", () => {
        /** 造一个带不可枚举成员键的既有分组。 */
        function groupWithHiddenKeys() {
            const group: Record<string, unknown> = { ["$label"]: "演示", ["$collapsed"]: false };
            Object.defineProperty(group, "foo", { value: { g1: true }, enumerable: false });
            Object.defineProperty(group, "~foo:pa-demo-bundle-foo", {
                value: { g2: true },
                enumerable: false,
            });
            return group;
        }

        it("组内已有不可枚举的目标键时,新建分支跳过不覆盖", async () => {
            const members = [member()];
            const group: Record<string, unknown> = { ["$label"]: "演示", ["$collapsed"]: false };
            Object.defineProperty(group, "~foo:pa-demo-bundle-foo", {
                value: { hidden: true },
                enumerable: false,
            });
            const ctx = createMockContext({ plugins: { [GROUP_KEY]: group } });
            const writer = createBundleConfigWriter(
                ctx.asContext(),
                requestOf(members),
                manifestOf(members, "演示"),
                members,
            );

            await writer.write();

            // for...in 探测不到不可枚举键,但取值命中:不覆盖已有配置
            expect(writer.configured).toEqual([]);
            expect(group["~foo:pa-demo-bundle-foo"]).toEqual({ hidden: true });
        });

        it("搬移的原键与合成键都被不可枚举键占用时记跳过", async () => {
            const members = [member({ move: true })];
            const group = groupWithHiddenKeys();
            const ctx = createMockContext({ plugins: { foo: { top: true }, [GROUP_KEY]: group } });
            const writer = createBundleConfigWriter(
                ctx.asContext(),
                requestOf(members),
                manifestOf(members, "演示"),
                members,
            );

            await writer.write();

            // in 判定命中不可枚举键:原键与合成键都"已占用",跳过搬移
            expect(writer.skipped).toEqual(["koishi-plugin-foo"]);
            expect(writer.moved).toEqual([]);
            expect(ctx.loader.config.plugins["foo"]).toEqual({ top: true });
        });
    });
});
