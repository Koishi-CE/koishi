/**
 * 将文本写入剪贴板：优先使用 Clipboard API，
 * 不可用（如非安全上下文 / 旧浏览器）时回退到隐藏 textarea + execCommand 的兼容方案。
 *
 * @param text 要复制的文本
 * @returns Clipboard API 路径下的写入 Promise，回退路径无返回值
 */
export async function copyToClipboard(text: string) {
	try {
		return navigator.clipboard.writeText(text);
	} catch {
		const element = document.createElement("textarea");
		const previouslyFocusedElement = document.activeElement;

		element.value = text;

		// 设为只读，避免移动端弹出软键盘
		element.setAttribute("readonly", "");

		element.style.contain = "strict";
		element.style.position = "absolute";
		element.style.left = "-9999px";
		element.style.fontSize = "12pt"; // 阻止 iOS 在聚焦时触发页面缩放

		const selection = document.getSelection();
		const originalRange = selection
			? selection.rangeCount > 0 && selection.getRangeAt(0)
			: null;

		document.body.appendChild(element);
		element.select();

		// iOS 上 select() 不生效，需手动指定选区范围
		element.selectionStart = 0;
		element.selectionEnd = text.length;

		document.execCommand("copy");
		document.body.removeChild(element);

		// originalRange 为真时 selection 必然存在,一并判断以收窄类型
		if (originalRange && selection) {
			selection.removeAllRanges();
			selection.addRange(originalRange);
		}

		// 将焦点还给此前聚焦的元素（若有）
		if (previouslyFocusedElement) {
			(previouslyFocusedElement as HTMLElement).focus();
		}
	}
}
