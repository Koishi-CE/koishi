import { describe, expect, it } from "vitest";
import { sanitizeInstallLogText } from "../store.js";

describe("sanitizeInstallLogText", () => {
	it("剥离 ANSI OSC 序列（如标题）", () => {
		expect(sanitizeInstallLogText("\x1b]0;Title\x07hello")).toBe("hello");
		expect(sanitizeInstallLogText("\x1b]0;Title\x1b\\hello")).toBe("hello");
	});

	it("剥离 ANSI CSI 颜色序列", () => {
		expect(sanitizeInstallLogText("\x1b[31mred\x1b[0m")).toBe("red");
		expect(sanitizeInstallLogText("\x1b[1;32mgreen\x1b[m")).toBe("green");
	});

	it("OSC 8 超链接只剥转义、保留可见文本", () => {
		expect(
			sanitizeInstallLogText("\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\end"),
		).toBe("linkend");
	});

	it("移除孤立回车（保留 CRLF）", () => {
		expect(sanitizeInstallLogText("a\r\nb\rc")).toBe("a\r\nbc");
	});

	it("普通文本原样保留", () => {
		expect(sanitizeInstallLogText("hello world")).toBe("hello world");
	});
});
