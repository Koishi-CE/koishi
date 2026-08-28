/**
 * @file 合包（plugin bundle）node 侧编排的聚合出口（market 域）。
 *
 * 两大函数族已按职责拆分,本文件仅原样转发导出,维持既有契约面:
 * - bundle-remove.ts:removeBundleConfigs——只清 koishi.yml 里合包分组
 *   成员的配置、不动依赖,分组清空后顺带删除空分组;
 * - bundle-install.ts:installBundle——market/bundle-install RPC 的服务端
 *   实现,重新拉取并校验合包清单（不信任 client 传来的清单）、解析勾选
 *   成员、防直接循环引用,然后把"合包自身 + 勾选成员"作为一个 override
 *   交给通用安装器,安装成功后写配置分组并持久化安装记录。
 *
 * 关键设计(完整说明见各子模块文件头):
 * - client 传的 bundle/members 仅作选项参考,清单以 registry 元数据重新解析
 *   为准,防止伪造请求写入任意配置;
 * - 安装记录（PluginBundleRecord）写入 MarketDataStore(data-store.ts),
 *   卸载/管理对话框靠它回放当时的安装选择。
 */
export { installBundle } from "./bundle-install.js";
export { removeBundleConfigs } from "./bundle-remove.js";
