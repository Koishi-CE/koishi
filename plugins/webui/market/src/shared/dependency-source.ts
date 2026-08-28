/**
 * @file 依赖来源（source）分类的共享语言层：类型定义 + 纯判定函数。
 *
 * 每个依赖条目按其"版本请求写法 + 安装状态"归入一个 DependencySource：
 * registry（普通 npm 依赖）、workspace / file / link / portal（四类本地依赖）、
 * git / url（远程直连）、unbound（已安装但 registry 全路由 404 的"未绑定
 * 本地插件"——形如 npm 包名，实为手工放进 node_modules 的本地插件）。
 *
 * 架构位置：shared 层纯函数、无 I/O。node 端（deps/resolver 快照构建、
 * installer 编排）与测试共同消费；分类结论通过 DataService 下发，
 * client 依赖卡片据此决定展示形态与可执行操作。
 */

/** 依赖来源枚举（见文件头注释的语义说明）。 */
export type DependencySource =
    | "registry"
    | "workspace"
    | "file"
    | "link"
    | "portal"
    | "git"
    | "url"
    | "unbound";

/** 来源分类结论：source 之外附带两个派生标记。 */
export interface DependencySourceInfo {
    source: DependencySource;
    /** 是否本地依赖（file/link/portal/workspace/unbound）。 */
    local: boolean;
    /** 是否"已绑定"：能被包管理器按声明重新解析（unbound 为 false）。 */
    bound: boolean;
}

/** classifyDependencySource 的观测输入（调用方按已知事实选择性提供）。 */
export interface DependencySourceOptions {
    /** koishi.yml 工作区标记（$workspace）。 */
    workspace?: boolean | undefined;
    /** node_modules 里是否已装。 */
    installed?: boolean | undefined;
    /** 扫描器是否在本地发现了同名插件（未声明却存在）。 */
    discoveredLocal?: boolean | undefined;
    /** registry 全路由是否 404。 */
    registryNotFound?: boolean | undefined;
}

/** 来源分类所需的最小依赖字段（resolver 的 Dependency 是它的超集）。 */
export interface DependencySourceState {
    request?: string | undefined;
    resolved?: string | undefined;
    source?: DependencySource | undefined;
    local?: boolean | undefined;
    bound?: boolean | undefined;
    workspace?: boolean | undefined;
}

/** shouldIncludeDiscoveredLocalPlugin 的观测输入。 */
export interface DiscoveredLocalPluginOptions {
    /** 已在 package.json 声明（声明过的走正常依赖路径，无需发现机制）。 */
    declared?: boolean | undefined;
    /** koishi.yml 里已配置。 */
    configured?: boolean | undefined;
    /** 当前正在运行。 */
    running?: boolean | undefined;
    /** 属于工作区。 */
    workspace?: boolean | undefined;
}

/** 协议前缀即本地依赖的四类：file/link/portal/workspace。 */
const LOCAL_PROTOCOLS = ["file", "link", "portal", "workspace"] as const;

/**
 * 按版本请求写法 + 观测事实分类依赖来源。判定优先级从高到低：
 * 1. 本地协议前缀（file:/link:/portal:/workspace:）→ 对应本地来源；
 * 2. 裸本地路径（./、../、盘符、根斜杠）→ file；
 * 3. workspace 标记 → workspace；
 * 4. http(s)/ftp URL → url；git 协议 / 简写 owner/repo → git；
 * 5. 已安装且（本地发现或 registry 404）→ unbound；
 * 6. 兜底 → registry。
 *
 * @param request 版本请求字符串（package.json 里的写法）
 */
export function classifyDependencySource(
    request = "",
    options: DependencySourceOptions = {},
): DependencySourceInfo {
    const value = request.trim();
    const protocol = LOCAL_PROTOCOLS.find((protocol) =>
        value.toLowerCase().startsWith(`${protocol}:`),
    );
    if (protocol) {
        return {
            source: protocol,
            local: true,
            bound: true,
        };
    }
    if (isLocalPath(value)) return { source: "file", local: true, bound: true };
    if (options.workspace) return { source: "workspace", local: true, bound: true };
    if (/^(?:https?|ftp):/i.test(value)) return { source: "url", local: false, bound: true };
    if (
        /^(?:git(?:\+[^:]+)?|github|gitlab|bitbucket):/i.test(value) ||
        /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(value)
    ) {
        return { source: "git", local: false, bound: true };
    }
    if (options.installed && (options.discoveredLocal || options.registryNotFound)) {
        return { source: "unbound", local: true, bound: false };
    }
    return { source: "registry", local: false, bound: true };
}

/**
 * registry 拉取 404 后的复分类：仅针对"已安装、此前被视为 registry 依赖、
 * 且包名通过插件命名检查"的条目改判 unbound。其余情况返回 undefined
 * （保持原分类不动）。
 *
 * @param plugin Scanner.isPlugin 的结论：包名像 Koishi 插件才允许判 unbound
 */
export function classifyRegistryNotFoundDependency(
    dependency: DependencySourceState | undefined,
    plugin: boolean,
): DependencySourceInfo | undefined {
    if (!plugin || !dependency?.resolved || dependency.source !== "registry") return;
    return classifyDependencySource(dependency.request, {
        installed: true,
        registryNotFound: true,
    });
}

/**
 * 快照重建时的"已确认 unbound"复用判定：上一轮已判 unbound、且 404 负缓存
 * 仍在可信窗口内（confirmationFresh）、且请求与已装版本都没变时，返回
 * unbound 结论供调用方直接沿用——避免负缓存窗口内闪烁回 registry。
 * 任一条件不满足返回 undefined。
 */
export function reuseConfirmedDependencySource(
    previous: DependencySourceState | undefined,
    current: DependencySourceState | undefined,
    confirmationFresh: boolean,
): DependencySourceInfo | undefined {
    if (!confirmationFresh || previous?.source !== "unbound") return;
    if (
        !current?.resolved ||
        previous.request !== current.request ||
        previous.resolved !== current.resolved
    )
        return;
    return { source: "unbound", local: true, bound: false };
}

/**
 * 找出仍处于 unbound、且本次安装清单未触及的依赖名（安装清单里有的
 * 即将改变状态，不再按 unbound 处理），按包名排序返回。
 */
export function findUnboundLocalDependencies(
    dependencies: Record<string, DependencySourceState | undefined>,
    changes: Record<string, string | undefined>,
) {
    return Object.entries(dependencies)
        .filter(([name, dependency]) => {
            if (dependency?.source !== "unbound") return false;
            return !Object.hasOwn(changes, name);
        })
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b));
}

/**
 * 找出"需要再做一轮来源核查"的依赖名：已装、仍标 registry、不在已完成
 * 集合、也不在本次安装清单里的条目——它们可能在 registry 侧刚变成 404
 * （被下架），需要重跑元数据确认是否改判 unbound。
 */
export function findDependenciesNeedingSourceCheck(
    dependencies: Record<string, DependencySourceState | undefined>,
    changes: Record<string, string | undefined>,
    completedNames: Iterable<string>,
) {
    const completed = new Set(completedNames);
    return Object.entries(dependencies)
        .filter(([name, dependency]) => {
            if (!dependency || isLocalDependency(dependency)) return false;
            if (!dependency.resolved || dependency.source !== "registry") return false;
            if (completed.has(name)) return false;
            return !Object.hasOwn(changes, name);
        })
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b));
}

/** 是否本地系依赖：local/workspace 标记直接命中，否则看 source 是否本地四类 + unbound。 */
export function isLocalDependency(dependency?: DependencySourceState) {
    if (!dependency) return false;
    if (dependency.local || dependency.workspace) return true;
    return (
        dependency.source === "workspace" ||
        dependency.source === "file" ||
        dependency.source === "link" ||
        dependency.source === "portal" ||
        dependency.source === "unbound"
    );
}

/**
 * 扫描发现的本地插件是否值得列入依赖面板：已声明的排除（走正常路径），
 * 其余只要"已配置 / 运行中 / 属于工作区"任一成立就纳入。
 */
export function shouldIncludeDiscoveredLocalPlugin(options: DiscoveredLocalPluginOptions) {
    if (options.declared) return false;
    return !!(options.configured || options.running || options.workspace);
}

/** 全部 registry 路由尝试都 404（空列表不算,避免无尝试时误判）。 */
export function allRegistryAttemptsNotFound(reasons: Array<string | undefined>) {
    return reasons.length > 0 && reasons.every((reason) => reason === "not-found");
}

/**
 * 从错误对象提取各路由的失败原因:优先读多路由竞速塞进错误的
 * marketNextReasons 数组,没有则退回单一 fallback 原因。
 */
export function getRegistryAttemptReasons(error: unknown, fallback?: string) {
    const reasons = (error as { marketNextReasons?: unknown })?.marketNextReasons;
    if (Array.isArray(reasons)) {
        const normalized = reasons.filter(
            (reason): reason is string => typeof reason === "string" && !!reason,
        );
        if (normalized.length) return normalized;
    }
    return fallback ? [fallback] : [];
}

/**
 * 该失败原因是否要给路由降权:404 是确定性结论（包不存在）不降权，
 * 其余（超时/网络等）视为路由质量信号,统计上降权。
 */
export function shouldPenalizeRegistryRoute(reason?: string) {
    return reason !== "not-found";
}

/** 裸本地路径判定:./ ../ 开头、Windows 盘符、或 / // 根路径。 */
function isLocalPath(value: string) {
    return /^(?:\.{1,2}[\\/]|[a-z]:[\\/]|[\\/]{1,2})/i.test(value);
}
