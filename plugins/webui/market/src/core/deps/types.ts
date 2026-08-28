/**
 * @file 依赖条目类型定义(core/deps 域)。
 *
 * 模块职责:定义 dependencies 数据通道的值类型 `Dependency`——宿主 package.json 中
 * 单个依赖条目的请求范围、已装版本与来源分类状态。
 *
 * 架构位置:core 领域层 deps 模块的类型出口,由同目录 resolver.ts 构造与维护,
 * 被 install 域(环境快照采集、安装来源校验)与 node 适配层的 DataService 消费。
 * `source/local/bound` 字段的取值语义由 shared/dependency-source.ts 的来源协议
 * 分类决定,本类型只承载分类结果。
 */
import type { DependencySource } from "../../shared/dependency-source.js";

/** 依赖条目：请求范围、已装版本、来源分类与 latest（dependencies 通道的值类型）。 */
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
    /** dependency origin used to decide whether npm may manage it */
    source?: DependencySource | undefined;
    /** whether this dependency is supplied by a local source */
    local?: boolean | undefined;
    /** whether package.json contains a reproducible local source */
    bound?: boolean | undefined;
    /** valid (unsupported) syntax */
    invalid?: boolean | undefined;
    /** latest version */
    latest?: string | undefined;
}
