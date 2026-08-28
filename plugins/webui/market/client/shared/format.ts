/**
 * @file client 域通用展示格式化函数。
 *
 * 端点 URL 的 host 提取在此唯一实现:依赖卡状态/安装历史/调试面板
 * 三处此前各持一份相同逻辑,统一后展示口径一致(带端口)。
 */

/** 端点 URL → host(含端口);解析失败(相对路径等)原样返回。 */
export function endpointHost(endpoint: string) {
  try {
    return new URL(endpoint).host
  } catch {
    return endpoint
  }
}
