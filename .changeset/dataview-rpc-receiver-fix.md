---
"@koishi-ce/plugin-dataview": patch
---

修复 database/* 系列 RPC 因丢失方法宿主而全数报错、页面整表空白的问题。addListener 代理数据库方法时把方法引用取出裸调，minato 的方法内部依赖 this（get 首行即 this.select），detached 调用直接抛 TypeError，被前端 updateData 的静默 catch 吞成空表格；改为经宿主对象成员调用，与上游 @koishijs/plugin-dataview 2.3.1 的写法对齐。
