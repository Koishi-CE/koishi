// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026-present Koishi-CE contributors.

/**
 * 浏览器端类型程序的插件类型接线（随基座 tsconfig.client.json 的 files
 * 下发进所有 client 子工程）：
 *
 * 各 webui 插件的 Console.Services / Console.Events 增强声明在各自
 * node 侧源码（declare module "@koishi-ce/console"，单一事实源），经
 * lib 产物 d.ts 携带。浏览器端类型程序以 paths 指向真实包产物
 * （tsconfig.client.json），本文件用副作用导入（d.ts 内无运行时代码）把这些 d.ts
 * 拉入程序，使 node 侧增强在此合并生效——client 侧不再手写任何镜像。
 *
 * 新增带控制台前端增强声明的插件时，在此追加一行导入。
 */
import "@koishi-ce/plugin-admin";
import "@koishi-ce/plugin-analytics";
import "@koishi-ce/plugin-auth";
import "@koishi-ce/plugin-commands";
import "@koishi-ce/plugin-config";
import "@koishi-ce/plugin-dataview";
import "@koishi-ce/plugin-explorer";
import "@koishi-ce/plugin-insight";
import "@koishi-ce/plugin-locales";
import "@koishi-ce/plugin-market";
import "@koishi-ce/plugin-logger";
import "@koishi-ce/plugin-notifier";
import "@koishi-ce/plugin-sandbox";
import "@koishi-ce/plugin-status";
