// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2019-present Shigma and Koishijs contributors.
// Copyright (c) 2026-present Koishi-CE contributors.

// 注册 explorer 插件用到的全部自定义 SVG 图标：
// activity:explorer 为页面入口图标，其余为文件树节点类型图标与菜单动作图标
import { icons } from "@koishi-ce/client";
import Activity from "./activity.vue";
import Directory from "./directory.vue";
import DirectoryCreate from "./directory-create.vue";
import Download from "./download.vue";
import File from "./file.vue";
import FileCreate from "./file-create.vue";
import Refresh from "./refresh.vue";
import Save from "./save.vue";
import Symlink from "./symlink.vue";
import Upload from "./upload.vue";

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
