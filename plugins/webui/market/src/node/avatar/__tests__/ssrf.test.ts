import { lookup } from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";
import {
    isAvatarCacheLikelyDefault,
    isAvatarDefaultResponse,
    isBlockedAvatarTarget,
} from "../ssrf.js";

vi.mock("node:dns/promises", () => ({
    lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

describe("isBlockedAvatarTarget", () => {
    it("屏蔽本地主机名", async () => {
        await expect(isBlockedAvatarTarget(new URL("http://localhost/x"))).resolves.toBe(true);
        await expect(
            isBlockedAvatarTarget(new URL("http://localhost.localdomain/x")),
        ).resolves.toBe(true);
    });

    it("白名单主机直接放行（不查 DNS）", async () => {
        await expect(
            isBlockedAvatarTarget(new URL("https://s.gravatar.com/avatar/a.png")),
        ).resolves.toBe(false);
        await expect(isBlockedAvatarTarget(new URL("https://www.npmjs.com/x"))).resolves.toBe(
            false,
        );
        expect(mockedLookup).not.toHaveBeenCalled();
    });

    it("IPv4 私网地址判定", async () => {
        for (const ip of [
            "127.0.0.1",
            "10.1.2.3",
            "192.168.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "169.254.1.1",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            // private-ip 全段表补齐的保留段(旧手写判定遗漏)
            "100.64.1.1",
            "198.18.0.1",
            "192.0.2.1",
        ]) {
            await expect(isBlockedAvatarTarget(new URL(`http://${ip}/x`))).resolves.toBe(true);
        }
        for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1"]) {
            await expect(isBlockedAvatarTarget(new URL(`http://${ip}/x`))).resolves.toBe(false);
        }
        expect(mockedLookup).not.toHaveBeenCalled();
    });

    it("IPv6 地址判定", async () => {
        for (const ip of [
            "::1",
            "fe80::1",
            "fc00::1",
            "fd00::1",
            "ff02::1",
            "::ffff:8.8.8.8",
            // IPv4-mapped 展开形式也整段拦截(SSRF 混淆形态)
            "0:0:0:0:0:ffff:7f00:1",
            "0:0:0:0:0:ffff:10.0.0.1",
            // 2001:db8::/32 文档段按 IANA 特殊用途段拦截(private-ip 全段表)
            "2001:db8::1",
        ]) {
            await expect(isBlockedAvatarTarget(new URL(`http://[${ip}]/x`))).resolves.toBe(true);
        }
        await expect(isBlockedAvatarTarget(new URL("http://[2606:4700::1111]/x"))).resolves.toBe(
            false,
        );
    });

    it("主机名解析到私网则屏蔽", async () => {
        mockedLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
        await expect(isBlockedAvatarTarget(new URL("http://evil.example/x"))).resolves.toBe(true);
    });

    it("主机名解析到公网则放行", async () => {
        mockedLookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
        await expect(isBlockedAvatarTarget(new URL("http://ok.example/x"))).resolves.toBe(false);
    });

    it("无解析记录或解析失败视为屏蔽", async () => {
        mockedLookup.mockResolvedValue([] as never);
        await expect(isBlockedAvatarTarget(new URL("http://empty.example/x"))).resolves.toBe(true);
        mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
        await expect(isBlockedAvatarTarget(new URL("http://fail.example/x"))).resolves.toBe(true);
    });
});

describe("isAvatarCacheLikelyDefault", () => {
    it("gravatar 默认占位参数命中", () => {
        expect(
            isAvatarCacheLikelyDefault(
                "https://s.gravatar.com/avatar/a.png?d=default",
                "gravatar:x",
            ),
        ).toBe(true);
        expect(
            isAvatarCacheLikelyDefault("https://www.gravatar.com/avatar/a.png?d=mp", "gravatar:x"),
        ).toBe(true);
    });

    it("d=404 明确要求失败反馈时不视为默认", () => {
        expect(
            isAvatarCacheLikelyDefault("https://s.gravatar.com/avatar/a.png?d=404", "gravatar:x"),
        ).toBe(false);
    });

    it("gravatar 无 d 参数且 key 为 gravatar 时视为默认", () => {
        expect(
            isAvatarCacheLikelyDefault("https://s.gravatar.com/avatar/a.png", "gravatar:x"),
        ).toBe(true);
        expect(isAvatarCacheLikelyDefault("https://s.gravatar.com/avatar/a.png", "url:x")).toBe(
            false,
        );
    });

    it("非 gravatar 主机与非法 URL 返回 false", () => {
        expect(isAvatarCacheLikelyDefault("https://example.com/a?d=default", "gravatar:x")).toBe(
            false,
        );
        expect(isAvatarCacheLikelyDefault("not a url", "gravatar:x")).toBe(false);
    });
});

describe("isAvatarDefaultResponse", () => {
    it("avatar-from 响应头判定", () => {
        expect(isAvatarDefaultResponse(new Headers({ "avatar-from": "default" }))).toBe(true);
        expect(isAvatarDefaultResponse(new Headers({ "avatar-from": "mp" }))).toBe(true);
        expect(isAvatarDefaultResponse(new Headers({ "avatar-from": "DEFAULT" }))).toBe(true);
        expect(isAvatarDefaultResponse(new Headers({ "avatar-from": "custom" }))).toBe(false);
        expect(isAvatarDefaultResponse(new Headers())).toBe(false);
    });
});
