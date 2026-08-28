/**
 * @file 市场条目作者/维护者列表的归一与缓存(market 域)。
 *
 * 模块职责:决定一张市场卡片 footer 上到底展示哪些人——若包的
 * maintainers 不是 contributors 中的成员,优先展示 maintainers(通常是
 * npm 上的真实维护者);否则展示去重后的 contributors。结果按条目对象
 * 用 WeakMap 缓存,避免每次渲染重算。
 *
 * 消费方:package.vue 的 avatarViews、utils.ts 的 validate(email: 查询)。
 */

import type { SearchObject, User } from "@koishi-ce/registry";

/** 条目对象 → 展示用户列表的缓存(条目被快照替换时自动释放)。 */
const usersCache = new WeakMap<SearchObject, User[]>();

/**
 * 取某市场条目应展示的用户列表:
 * 1. 缓存命中直接返回;
 * 2. contributors 按 getUserKey 去重(同人多次贡献只留第一个);
 * 3. 若没有任何 maintainer 出现在 contributors 里,返回 maintainers
 *    (name 缺省时回落到 username);否则返回去重后的 contributors。
 */
export function getUsers(data: SearchObject) {
	const cached = usersCache.get(data);
	if (cached) return cached;
	const result: Record<string, User> = {};
	for (const user of data.package.contributors ?? []) {
		const key = getUserKey(user);
		if (!key) continue;
		result[key] ||= user;
	}
	const users = !data.package.maintainers.some(
		(user) => result[getUserKey(user)],
	)
		? data.package.maintainers.map((user) => ({
				...user,
				name: user.name || user.username,
			}))
		: Object.values(result);
	usersCache.set(data, users);
	return users;
}

/** 用户的去重标识:email 优先,其次 username,最后 name(都缺则空串)。 */
export function getUserKey(user: User) {
	return user.email || user.username || user.name;
}
