export const messageZh = {
	commands: {
		plugin: {
			description: "插件管理",
			install: {
				description: "安装插件",
				messages: {
					"expect-name": "请输入插件名。",
					"already-installed": "该插件已安装。",
					"not-found": "未找到该插件。",
					success: "安装成功！",
				},
			},
			uninstall: {
				description: "卸载插件",
				messages: {
					"expect-name": "请输入插件名。",
					"not-installed": "该插件未安装。",
					success: "卸载成功！",
				},
			},
			upgrade: {
				description: "升级插件",
				options: {
					self: "升级 Koishi 本体",
					force: "忽略更新屏蔽规则并强制检查",
				},
				messages: {
					"all-updated": "所有插件已是最新版本。",
					available: "有可用的依赖更新：",
					prompt: "输入「Y」升级全部依赖，输入「N」取消操作。",
					cancelled: "已取消操作。",
					failed: "升级失败，包管理器退出码为 {0}。",
					success: "升级成功！",
				},
			},
			"clear-avatar-cache": {
				description: "清理 market-next 头像缓存",
				messages: {
					success: "已清理头像缓存：内存 {0} 条，磁盘 {1} 个文件。",
				},
			},
		},
	},
} as const;

export const messageEn = {
	commands: {
		plugin: {
			description: "Plugin management",
			install: {
				description: "Install Plugins",
				messages: {
					"expect-name": "Please enter a plugin name.",
					"already-installed": "This plugin is already installed.",
					"not-found": "Plugin not found.",
					success: "Installation Successful!",
				},
			},
			uninstall: {
				description: "Uninstall plugin",
				messages: {
					"expect-name": "Please enter a plugin name.",
					"not-installed": "This plugin is not installed.",
					success: "Uninstalled successfully!",
				},
			},
			upgrade: {
				description: "Upgrade Plugin",
				options: {
					self: "Upgrade Koishi core",
					force: "Ignore update rules and force an update check",
				},
				messages: {
					"all-updated": "All plugins are already up to date.",
					available: "Available dependency updates:",
					prompt: "Enter Y to upgrade all dependencies, or N to cancel.",
					cancelled: "Operation canceled.",
					failed: "Upgrade failed with package manager exit code {0}.",
					success: "Upgrade Successful!",
				},
			},
			"clear-avatar-cache": {
				description: "Clear market-next avatar cache",
				messages: {
					success: "Cleared avatar cache: {0} memory entries, {1} disk files.",
				},
			},
		},
	},
} as const;

export const schemaZh = {
	registry: {
		$description: "插件源设置",
		endpoint: "插件的下载源。默认跟随当前项目的 npm config。",
		timeout: "获取插件数据的超时时间。",
		autoRoute: "当前下载源获取版本失败时自动尝试备用 npm 源。",
		retry: "每个 npm 源获取版本失败后的重试次数。",
		concurrency: "批量获取依赖版本时的最大并发数。",
		installLogRetentionHours:
			"依赖安装、更新与卸载操作日志保留多少小时，默认 72 小时。",
	},
	search: {
		$description: "搜索设置",
		endpoint: "用于搜索插件市场的网址。默认使用 t4wefan 镜像。",
		timeout: "搜索插件市场的超时时间。",
		proxyAgent: "用于搜索插件市场的代理。",
		autoRoute: "当前市场源失败时自动尝试备用市场源。",
		logLevel: "插件市场调试日志级别。silent 关闭日志，debug 输出最详细。",
	},
	marketSilentFilters: "旧版永久静默过滤。",
	idleProbe:
		"Console 空闲时自动探测依赖版本和插件市场数据。仅在没有浏览器控制台连接时运行，不会因为刷新页面触发。",
	idleProbeDelay: "Console 无人在线多久后开始后台探测。",
	idleProbeBootDelay: "Koishi 启动或重载后，至少等待多久才允许空闲探测。",
	idleProbeInterval: "两次空闲后台探测之间的最小间隔。",
	bulkMode:
		"批量操作模式。开启后安装、更新、卸载会先暂存，点击“应用更改”后执行。",
	removeConfig: {
		$description: "卸载插件时是否同时删除已有插件配置。未设置时每次询问。",
		$inner: ["每次询问", "始终删除插件配置", "永不删除插件配置"],
	},
	updateIgnoredPackages:
		"不检测更新的依赖名。每行一个包名，也可以使用逗号、分号或空格分隔。",
	updateIgnoreDuration:
		"点击“忽略此次更新”后的默认忽略时长。0 表示不按时间过期。",
	updateIgnoreVersions:
		"点击“忽略此次更新”后连续忽略几个新版本。1 表示只忽略当前最新版本。",
	updateIgnorePrerelease:
		"手动开启后，alpha / beta / rc 等预发布版本不会被视为可更新版本。",
	marketSilentRules: {
		$description:
			"插件市场永久静默过滤。添加后命中的插件会直接隐藏，不会显示在搜索框中。",
		type: {
			$description: "规则类型",
			$inner: [
				"状态：预览版插件",
				"状态：不安全插件",
				"状态：插件包",
				"创建时间：早于指定日期",
				"创建时间：晚于指定日期",
				"更新时间：早于指定日期",
				"更新时间：晚于指定日期",
				"创建时间：最近 N 天内",
				"更新时间：最近 N 天内",
				"自定义高级条件",
			],
		},
		value:
			"规则值。状态类留空；日期类填写 YYYY-MM-DD；最近 N 天填写数字；自定义规则填写搜索条件。",
		note: "备注",
		enabled: "是否启用",
	},
} as const;

export const schemaEn = {
	registry: {
		$description: "Registry settings",
		endpoint:
			"Package download source. Follows the current project's npm config by default.",
		timeout: "Timeout for fetching package metadata.",
		autoRoute:
			"Automatically try fallback npm registries when version metadata cannot be fetched from the current registry.",
		retry: "Retry count after version metadata fails on each npm registry.",
		concurrency:
			"Maximum concurrency when loading dependency version metadata.",
		installLogRetentionHours:
			"How many hours dependency operation logs are retained. Defaults to 72 hours.",
	},
	search: {
		$description: "Search settings",
		endpoint:
			"URL used to search the plugin market. Uses the t4wefan mirror by default.",
		timeout: "Timeout for searching the plugin market.",
		proxyAgent: "Proxy used to search the plugin market.",
		autoRoute:
			"Automatically try fallback market sources when the current source fails.",
		logLevel:
			"Plugin market log level. silent disables logs; debug enables detailed logs.",
	},
	marketSilentFilters: "Legacy permanent silent filters.",
	idleProbe:
		"Automatically probes dependency versions and market data while Console is idle. It only runs when no browser console is connected, and page reloads do not trigger it.",
	idleProbeDelay:
		"How long Console must stay idle before the background probe starts.",
	idleProbeBootDelay:
		"Minimum delay after Koishi startup or reload before idle probing is allowed.",
	idleProbeInterval: "Minimum interval between idle background probes.",
	bulkMode:
		"Batch operation mode. Dependency install, update, and uninstall actions are staged until applying changes.",
	removeConfig: {
		$description:
			"Whether to remove existing plugin config when uninstalling a plugin. Ask every time when unset.",
		$inner: [
			"Ask every time",
			"Always remove plugin config",
			"Never remove plugin config",
		],
	},
	updateIgnoredPackages:
		"Dependency package names that should not be checked for updates. One package per line, or separated by commas, semicolons, or spaces.",
	updateIgnoreDuration:
		"Default duration after ignoring one update. 0 means no time-based expiry.",
	updateIgnoreVersions:
		"How many consecutive newer versions should be ignored after ignoring one update. 1 means only the current latest version.",
	updateIgnorePrerelease:
		"When enabled, alpha / beta / rc and other prerelease versions are not treated as update targets.",
	marketSilentRules: {
		$description:
			"Permanent silent market filters. Matched plugins are hidden from the market page.",
		type: {
			$description: "Rule type",
			$inner: [
				"Status: plugin in development",
				"Status: insecure plugin",
				"Status: plugin bundle",
				"Created before a date",
				"Created after a date",
				"Updated before a date",
				"Updated after a date",
				"Created within the last N days",
				"Updated within the last N days",
				"Custom advanced condition",
			],
		},
		value:
			"Rule value. Leave status rules empty; use YYYY-MM-DD for dates, a number for recent-day rules, or a search condition for custom rules.",
		note: "Note",
		enabled: "Enabled",
	},
} as const;
