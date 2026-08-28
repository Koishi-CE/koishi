/**
 * which-pm-runs 的类型垫片：该包自身不携带类型声明，这里补充最小接口。
 * whichPMRuns() 通过解析 process.env.npm_config_user_agent 探测当前进程
 * 是由哪个包管理器（npm / yarn / pnpm / bun …）启动的，探测不到返回
 * undefined，调用方据此选择后续的安装命令。
 */
declare module "which-pm-runs" {
	interface PMAgent {
		name: string;
		version: string;
	}
	export function whichPMRuns(): PMAgent | undefined;
}
