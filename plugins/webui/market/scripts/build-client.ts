/**
 * build-client.ts：控制台前端 prod 构建。
 *
 * 等价 @koishi-ce/client 官方 build()（宿主 node_modules/@koishi-ce/client/lib/index.js）
 * 的编程式结构：`client/index.ts` → `dist/index.js` + `dist/style.css`，走
 * `vite.build({ write: false })` + 手动落地，完全掌控产物名。
 *
 * - external：vue / vue-router / @vueuse/core / @koishi-ce/client——prod 由宿主
 *   console 静态服务（`/@plugin-<key>/`），dev 由 console vite server 提供。
 * - 产物名硬约束：prod console 只探测 `index.js` + `style.css`
 *   （@koishijs/plugin-console 的 resolveEntry），落地后校验，缺一即失败。
 * - `cssFileName: 'style'`（Vite 8）为主路径；`index.css` → `style.css` 改名
 *   兜底（对齐旧官方 build.mjs 的 copy 行为）。`index.mjs` → `index.js`
 *   改名兜底同理，均防 Vite 产物名行为变化。
 * - chunk 落地前经 vite.minify（rolldown oxc codegen 去空白）二次压缩，
 *   对应官方 build() 的 transformWithEsbuild 二次压缩步骤。
 * - dev 模式无需此脚本：宿主 console vite server 经 `/vite/@fs/` 实时编译
 *   client/index.ts，unocss 等由宿主解析，不读本目录的构建配置。
 *
 * 用法：`yarn build:client` / `yarn build`（package.json scripts）。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import yaml from "@maikolib/vite-plugin-yaml";
import uno from "unocss/vite";
import presetMini from "unocss/preset-mini";
import * as vite from "vite";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist");

// write:false 时 emptyOutDir 不生效，参照官方 build() 手动清空重建
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// 对齐 @koishi-ce/client 官方打包配置（原 vite.config.ts 迁移至此，单一来源）：
// - external 只留运行时由 console 提供的包
// - alias 把 vue-i18n / @koishi-ce/components 指向 @koishi-ce/client
// - unocss 仅 preset-mini、无 preflight；prod 必须在此注册
//   （dev 由宿主 console vite server 解析，宿主不读本插件的自定义 vite 配置）
const results = await vite.build({
    root,
    // 自包含配置：禁掉默认的 vite.config.ts 加载，否则 plugins 与其 concat 后重复注册
    configFile: false,
    build: {
        write: false,
        outDir: "dist",
        assetsDir: "",
        minify: true,
        commonjsOptions: {
            strictRequires: true,
        },
        lib: {
            entry: resolve(root, "client/index.ts"),
            fileName: "index",
            // prod console 只探测 style.css；Vite 8 默认按入口名产出 index.css，需显式指定
            cssFileName: "style",
            formats: ["es"],
        },
        rollupOptions: {
            makeAbsoluteExternalsRelative: true,
            external: ["vue", "vue-router", "@vueuse/core", "@koishi-ce/client"],
        },
    },
    plugins: [
        vue(),
        yaml(),
        uno({
            presets: [presetMini({ preflight: false })],
        }),
    ],
    css: {
        preprocessorOptions: {
            scss: {
                api: "modern-compiler",
            },
        },
    },
    resolve: {
        alias: {
            "vue-i18n": "@koishi-ce/client",
            "@koishi-ce/components": "@koishi-ce/client",
        },
    },
    define: {
        "process.env.NODE_ENV": '"production"',
    },
});

type RollupOutput = Exclude<Awaited<ReturnType<typeof vite.build>>, unknown[]>;
const bundle = Array.isArray(results) ? results[0] : results;
if (!bundle) throw new Error("[build-client] vite.build 未返回产物");

const written = new Set<string>();
for (const item of bundle.output) {
    if (item.type === "chunk") {
        const fileName = item.fileName === "index.mjs" ? "index.js" : item.fileName;
        const dest = resolve(outDir, fileName);
        // 二次压缩空白（官方 build() 用 transformWithEsbuild，Vite 8 已弃用且需
        // 单独装 esbuild；这里用 vite 内置 re-export 的 rolldown oxc minify，
        // compress/mangle 关闭 = 仅 codegen 去空白，产物比 esbuild 版更小）
        const result = await vite.minify(fileName, item.code, {
            compress: false,
            mangle: false,
        });
        if (result.errors.length) {
            for (const error of result.errors) console.error(`[build-client] minify: ${error.message}`);
            process.exit(1);
        }
        await writeFile(dest, result.code);
        written.add(fileName);
    } else {
        const fileName = item.fileName === "index.css" ? "style.css" : item.fileName;
        await writeFile(resolve(outDir, fileName), item.source);
        written.add(fileName);
    }
}

// prod console 只探测 index.js + style.css（resolveEntry），缺一即失败
const missing = ["index.js", "style.css"].filter((name) => !written.has(name));
if (missing.length) {
    console.error(`[build-client] 产物缺失: ${missing.join(", ")}（prod console 只探测这两个名字）`);
    process.exit(1);
}
console.log(`[build-client] 完成: ${[...written].sort().join(", ")}`);
