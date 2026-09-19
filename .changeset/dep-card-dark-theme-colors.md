---
"@koishi-ce/plugin-market": patch
"@koishi-ce/client": patch
---

依赖页暗色观感修复:依赖卡边框引用了不存在的 `--k-border-color` 变量,整条 border 声明失效(卡片描边、版本占位虚线框、悬停高亮全部丢失),改回主题正名 `--k-color-border`;宿主为状态色 plain 按钮的浅底/描边系列补暗色映射(此前用 EP 默认亮色值,暗色界面里「卸载」按钮呈刺眼浅粉色块)。
