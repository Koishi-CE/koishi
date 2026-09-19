---
"create-koishi-ce": minor
---

模板预置 `overrides` 兜底层：41 个上游名强制重定向到 CE 对应包。

六行钉名依赖「落盘版本满足声明范围」，第三方插件声明钉名清单外的上游名（如 dependencies 直接依赖 `@koishijs/plugin-admin` / `@koishijs/utils`）或超出冻结线的范围（如未来上游升线后的 `^6`）时官方包仍会落盘。overrides 是包管理器级的强制重写，不看版本满足性，与钉名构成双层防线（napuketto 事件 2026-09-19 后的收口）。清单 = CE 已再分发且官方同名的包，逐一 npm view 核实；`plugin-cron`（上游是裸名社区包）与 CE 原创包不在列，不拦官方生态的真实依赖。sandbox 生成器（tooling/sandbox）同步同款清单，对账测试防漂移。
