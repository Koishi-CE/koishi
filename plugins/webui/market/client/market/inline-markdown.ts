/**
 * @file 行内 markdown 语法特征检测(market 域,纯函数)。
 *
 * 市场卡片的描述绝大多数是纯文本,但原版市场允许作者在 description 里
 * 使用 markdown 语法(k-markdown 渲染)。本模块用廉价正则先判断文本是否
 * 含语法特征:纯文本走零成本的插值渲染,仅含语法的文本才付 k-markdown
 * (marked 解析 + xss 净化)的挂载成本。
 *
 * 代价方向约定:误报(纯文本被判为 markdown)只是多付一次渲染成本,
 * 输出仍与原文一致(marked 对不成对/词内符号不产生强调);漏检(含语法
 * 未检出)才造成功能缺失,因此特征集合宁可从宽。
 */

/** 语法特征集合:任一命中即视为含 markdown 语法。 */
const INLINE_MARKDOWN_PATTERNS: RegExp[] = [
    // 强调:*x* / **x** / _x_ / __x__(成对符号,词内下划线误报无害)
    /\*[^*\n]+\*/,
    /_[^_\n]+_/,
    // 行内代码与围栏代码块:成对反引号 / 三连反引号
    /`[^`\n]*`/,
    /```/,
    // 链接与图片:[text](url)
    /\[[^\]\n]*\]\([^)\n]*\)/,
    // 删除线:~~x~~
    /~~[^~\n]+~~/,
    // 尖括号自动链接:<https://…> / <scheme:…>
    /<[a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*>/,
    // HTML 标签:<br> / <u>x</u> / <sub> 等(marked 会透传标签)
    /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>\n]*)?\/?>/,
    // 行首标题 / 无序列表 / 有序列表 / 引用(marked 同样按行首语法解析)
    /(?:^|\n)#{1,6}[ \t]+\S/,
    /(?:^|\n)[ \t]*[-*+][ \t]+\S/,
    /(?:^|\n)[ \t]*\d{1,9}[.)][ \t]+\S/,
    /(?:^|\n)[ \t]*>[ \t]*\S/,
]

/**
 * 检测文本是否含 markdown 语法特征。
 *
 * 逐模式短路求值,单次成本约几微秒;结果仅用于选择渲染分支,不做缓存
 * (虚拟滚动下每次挂载重算的成本远低于任何缓存簿记)。
 */
export function looksLikeMarkdown(text: string): boolean {
    if (!text) return false
    for (const pattern of INLINE_MARKDOWN_PATTERNS) {
        if (pattern.test(text)) return true
    }
    return false
}
