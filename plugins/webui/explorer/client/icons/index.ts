// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 注册 explorer 插件用到的全部自定义 SVG 图标：
// activity:explorer 为页面入口图标，其余为文件树节点类型图标与菜单动作图标
import { icons } from "@koishi-ce/client";
import Activity from "~icons/k/activity-explorer";
import Directory from "~icons/k/directory";
import DirectoryCreate from "~icons/k/directory-create";
import Download from "~icons/k/download";
import File from "~icons/k/file";
import FileCreate from "~icons/k/file-create";
import Refresh from "~icons/k/refresh";
import Save from "~icons/k/save";
import Symlink from "~icons/k/symlink";
import Upload from "~icons/k/upload";

icons.register("activity:explorer", Activity);
icons.register("directory", Directory);
icons.register("directory-create", DirectoryCreate);
icons.register("download", Download);
icons.register("file", File);
icons.register("file-create", FileCreate);
icons.register("refresh", Refresh);
icons.register("save", Save);
icons.register("symlink", Symlink);
icons.register("upload", Upload);
