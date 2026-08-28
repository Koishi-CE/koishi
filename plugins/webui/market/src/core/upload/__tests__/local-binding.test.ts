import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("../../install/sources/manifest-restore.js", () => ({
    snapshotPackageManifest: vi.fn(),
}));

import { execa } from "execa";
import { snapshotPackageManifest } from "../../install/sources/manifest-restore.js";
import {
    createHashedLocalBindingFilename,
    createLocalBindingRequest,
    type LocalBindingPrepareDeps,
    MAX_LOCAL_BINDING_PACK_SIZE,
    parseNpmPackOutput,
    prepareLocalBinding,
} from "../local-binding.js";

const NAME = "koishi-plugin-x";
const PACKED_CONTENT = "packed-archive-content";

let dir: string;
let cleanup: () => Promise<void>;

/** npm pack 产物桩:把固定内容写进 --pack-destination 并返回匹配的 JSON stdout。 */
async function fakeNpmPack() {
    vi.mocked(execa).mockImplementation((async (_cmd: string, args: readonly string[]) => {
        const temporary = args[args.indexOf("--pack-destination") + 1]!;
        const filename = `${NAME}-1.0.0.tgz`;
        await writeFile(join(temporary, filename), PACKED_CONTENT);
        return {
            stdout: JSON.stringify([
                {
                    filename,
                    size: Buffer.byteLength(PACKED_CONTENT),
                    name: NAME,
                    version: "1.0.0",
                },
            ]),
        };
    }) as never);
}

/** 构造宿主目录:package.json 依赖 + node_modules 内的插件清单。 */
async function makeHost(version = "1.0.0") {
    await mkdir(join(dir, "node_modules", NAME), { recursive: true });
    await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { [NAME]: "1.0.0" } }),
    );
    await writeFile(
        join(dir, "node_modules", NAME, "package.json"),
        JSON.stringify({ name: NAME, version }),
    );
}

/** 组装 deps 桩(cwd + log + resolver);标注接口类型以便断言 log/resolver 的调用。 */
function makeDeps(depCache: Record<string, unknown> = {}): LocalBindingPrepareDeps {
    return {
        cwd: dir,
        log: { info: vi.fn(), debug: vi.fn() },
        resolver: { getDeps: vi.fn(() => depCache) },
    } as unknown as LocalBindingPrepareDeps;
}

function healthyDepCache() {
    return { [NAME]: { resolved: "1.0.0", source: "unbound", request: "1.0.0" } };
}

beforeEach(async () => {
    const { makeTempDir } = await import("./helpers.js");
    ({ dir, cleanup } = await makeTempDir("market-binding-"));
    await fakeNpmPack();
    vi.mocked(snapshotPackageManifest).mockResolvedValue({
        dependencies: { [NAME]: "1.0.0" },
    } as never);
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await cleanup();
});

describe("parseNpmPackOutput", () => {
    it("解析合法输出", () => {
        expect(
            parseNpmPackOutput(
                '[{"filename":"foo-1.0.0.tgz","size":1234,"name":"foo","version":"1.0.0"}]',
            ),
        ).toEqual({ name: "foo", version: "1.0.0", filename: "foo-1.0.0.tgz", size: 1234 });
    });

    it("非数组/空数组/非法 JSON 抛错", () => {
        expect(() => parseNpmPackOutput("{}")).toThrow("invalid npm pack output");
        expect(() => parseNpmPackOutput("[]")).toThrow("invalid npm pack output");
        expect(() => parseNpmPackOutput("not json")).toThrow("invalid npm pack output");
    });

    it("非法文件名抛错", () => {
        expect(() => parseNpmPackOutput('[{"filename":"../evil.tgz","size":1}]')).toThrow(
            "invalid npm pack filename",
        );
        expect(() => parseNpmPackOutput('[{"filename":"foo.tar","size":1}]')).toThrow(
            "invalid npm pack filename",
        );
        expect(() => parseNpmPackOutput('[{"filename":123,"size":1}]')).toThrow(
            "invalid npm pack filename",
        );
    });

    it("非法大小抛错", () => {
        expect(() => parseNpmPackOutput('[{"filename":"foo.tgz","size":0}]')).toThrow(
            "invalid npm pack size",
        );
        expect(() => parseNpmPackOutput('[{"filename":"foo.tgz","size":-1}]')).toThrow(
            "invalid npm pack size",
        );
        expect(() => parseNpmPackOutput('[{"filename":"foo.tgz","size":1.5}]')).toThrow(
            "invalid npm pack size",
        );
        const tooBig = `[{"filename":"foo.tgz","size":${String(MAX_LOCAL_BINDING_PACK_SIZE + 1)}}]`;
        expect(() => parseNpmPackOutput(tooBig)).toThrow("invalid npm pack size");
    });

    it("name/version 为非字符串时归一为 undefined", () => {
        expect(
            parseNpmPackOutput('[{"filename":"foo.tgz","size":10,"name":1,"version":null}]'),
        ).toEqual({ name: undefined, version: undefined, filename: "foo.tgz", size: 10 });
    });
});

describe("createLocalBindingRequest", () => {
    it("生成 file:.yarn/local 请求", () => {
        expect(createLocalBindingRequest("foo-1.0.0.tgz")).toBe("file:.yarn/local/foo-1.0.0.tgz");
    });

    it("非法文件名抛错", () => {
        expect(() => createLocalBindingRequest("a/b.tgz")).toThrow("invalid npm pack filename");
    });
});

describe("createHashedLocalBindingFilename", () => {
    it("注入内容 hash 前缀", () => {
        expect(createHashedLocalBindingFilename("foo-1.0.0.tgz", "ABCDEFabcdef123456789012")).toBe(
            "foo-1.0.0-abcdefabcdef123456789012.tgz",
        );
    });

    it("hash 过短或非法抛错", () => {
        expect(() => createHashedLocalBindingFilename("foo.tgz", "abc")).toThrow(
            "invalid npm pack hash",
        );
        expect(() => createHashedLocalBindingFilename("foo.tgz", "zzzzzzzzzzzz")).toThrow(
            "invalid npm pack hash",
        );
    });
});

describe("prepareLocalBinding", () => {
    it("完整链路:校验 → pack → 哈希命名 → 落位 .yarn/local → 清理临时目录", async () => {
        await makeHost();
        const deps = makeDeps(healthyDepCache());
        const result = await prepareLocalBinding(deps, NAME);

        const hash = createHash("sha256").update(PACKED_CONTENT).digest("hex");
        const filename = createHashedLocalBindingFilename(`${NAME}-1.0.0.tgz`, hash.slice(0, 12));
        expect(result).toEqual({
            request: `file:.yarn/local/${filename}`,
            filename,
            size: Buffer.byteLength(PACKED_CONTENT),
        });
        await expect(fsp.readFile(join(dir, ".yarn", "local", filename), "utf8")).resolves.toBe(
            PACKED_CONTENT,
        );
        // 临时打包目录被清理
        const leftovers = (await readdir(join(dir, ".yarn", "local"))).filter((name) =>
            name.startsWith(".market-next-pack-"),
        );
        expect(leftovers).toEqual([]);
        expect(deps.log.info).toHaveBeenCalled();
    });

    it("重复绑定时复用已存在的同内容归档", async () => {
        await makeHost();
        const deps = makeDeps(healthyDepCache());
        const first = await prepareLocalBinding(deps, NAME);
        const second = await prepareLocalBinding(deps, NAME);
        expect(second.filename).toBe(first.filename);
        expect(deps.resolver.getDeps).toHaveBeenCalledTimes(2);
    });

    it("非插件名 / 不在依赖表中时拒绝", async () => {
        await makeHost();
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, "foo")).rejects.toThrow("只能绑定当前 package.json");
        await expect(prepareLocalBinding(deps, "koishi-plugin-other")).rejects.toThrow(
            "只能绑定当前 package.json",
        );
    });

    it("依赖来源不是 unbound 本地插件时拒绝", async () => {
        await makeHost();
        const deps = makeDeps({
            [NAME]: { resolved: "1.0.0", source: "registry", request: "1.0.0" },
        });
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow("不是来源未绑定的本地插件");
    });

    it("package.json 快照与依赖状态不一致时拒绝", async () => {
        await makeHost();
        const deps = makeDeps({
            [NAME]: { resolved: "1.0.0", source: "unbound", request: "^1.0.0" },
        });
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow("package.json 已发生变化");
    });

    it("无法解析本地插件目录时拒绝", async () => {
        // 宿主目录里没有 node_modules/koishi-plugin-x
        await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow("无法定位本地插件目录");
    });

    it("本地清单版本与依赖状态不一致时拒绝", async () => {
        await makeHost("1.0.1"); // node_modules 里是 1.0.1,depCache resolved 是 1.0.0
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow(
            "本地插件清单与当前依赖状态不一致",
        );
    });

    it("pack 输出的包名与依赖不一致时拒绝", async () => {
        await makeHost();
        vi.mocked(execa).mockImplementationOnce((async () => ({
            stdout: JSON.stringify([
                {
                    filename: `${NAME}-1.0.0.tgz`,
                    size: Buffer.byteLength(PACKED_CONTENT),
                    name: "koishi-plugin-other",
                    version: "1.0.0",
                },
            ]),
        })) as never);
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow(
            "本地插件打包结果与当前依赖不一致",
        );
    });

    it("pack 声明大小与实际文件不符时拒绝", async () => {
        await makeHost();
        vi.mocked(execa).mockImplementationOnce((async (_cmd: string, args: readonly string[]) => {
            const temporary = args[args.indexOf("--pack-destination") + 1]!;
            await writeFile(join(temporary, `${NAME}-1.0.0.tgz`), PACKED_CONTENT);
            // 声明 size=1 与实际文件字节数不符
            return {
                stdout: JSON.stringify([
                    { filename: `${NAME}-1.0.0.tgz`, size: 1, name: NAME, version: "1.0.0" },
                ]),
            };
        }) as never);
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow("本地插件打包文件无效或过大");
    });

    it("同名归档内容不一致时拒绝覆盖", async () => {
        await makeHost();
        const hash = createHash("sha256").update(PACKED_CONTENT).digest("hex");
        const filename = createHashedLocalBindingFilename(`${NAME}-1.0.0.tgz`, hash.slice(0, 12));
        await mkdir(join(dir, ".yarn", "local"), { recursive: true });
        // 同长度但内容不同的篡改(长度不同会先命中"文件状态不一致"分支)
        await writeFile(join(dir, ".yarn", "local", filename), "Xacked-archive-content");
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow(
            "同名本地插件归档已存在，但文件内容不一致",
        );
    });

    it("同名归档大小不一致时按文件状态不一致拒绝", async () => {
        await makeHost();
        const hash = createHash("sha256").update(PACKED_CONTENT).digest("hex");
        const filename = createHashedLocalBindingFilename(`${NAME}-1.0.0.tgz`, hash.slice(0, 12));
        await mkdir(join(dir, ".yarn", "local"), { recursive: true });
        await writeFile(join(dir, ".yarn", "local", filename), "shorter");
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow(
            "同名本地插件归档已存在，但文件状态不一致",
        );
    });

    it("rename 失败且目标并未出现时抛原错误", async () => {
        await makeHost();
        const spy = vi
            .spyOn(fsp, "rename")
            .mockRejectedValue(Object.assign(new Error("EPERM: denied"), { code: "EPERM" }));
        const deps = makeDeps(healthyDepCache());
        await expect(prepareLocalBinding(deps, NAME)).rejects.toThrow("EPERM: denied");
        spy.mockRestore();
    });

    it("临时目录清理失败仅记 debug 日志", async () => {
        await makeHost();
        const hash = createHash("sha256").update(PACKED_CONTENT).digest("hex");
        const filename = createHashedLocalBindingFilename(`${NAME}-1.0.0.tgz`, hash.slice(0, 12));
        // 预置同内容目标:走复用分支,首笔 fsp.rm 即临时目录清理
        await mkdir(join(dir, ".yarn", "local"), { recursive: true });
        await writeFile(join(dir, ".yarn", "local", filename), PACKED_CONTENT);
        vi.spyOn(fsp, "rm").mockRejectedValueOnce(new Error("EBUSY"));
        const deps = makeDeps(healthyDepCache());
        const result = await prepareLocalBinding(deps, NAME);
        expect(result.filename).toBe(filename);
        expect(deps.log.debug).toHaveBeenCalledWith(expect.stringContaining("failed to remove"));
    });
});
